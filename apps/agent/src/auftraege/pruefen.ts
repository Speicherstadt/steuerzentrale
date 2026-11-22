import {
  befehlFuellen,
  befehlZurAktion,
  INSTALLATIONS_NAME,
  istPforteAktion,
  type Manifest,
  type OeffentlicherSchluessel,
  PFORTE_ZEITLIMIT_S,
  type PforteAuftrag,
  pforteAuftragPruefen,
  STANDARD_ZEITLIMIT_S,
  schluesselVertrauen,
  signiertesManifestLaden,
  type Zweck,
} from "@steuerzentrale/manifest";
import type { NachrichtVonDerZentrale } from "@steuerzentrale/protokoll";

/*
 * What the agent checks before it runs anything a job asks (BAULISTE.md Z-305; docs/plan.md, "Was
 * der Agent ausführt"), in this order: the key it trusts (never the public test key outside test
 * mode), the manifest's minisign signature over its exact bytes, the action as a command of that
 * manifest, the arguments against the command's declaration. Only then is there an argv to run,
 * taken from the signed manifest. A job of the Pforte (Z-401) passes the same key and signature
 * checks, then its fixed shape (packages/manifest, pforte/auftraege.ts) instead of a command; its
 * route is rendered from the signed manifest. Pure, no I/O.
 */

export type AuftragNachricht = Extract<NachrichtVonDerZentrale, { typ: "auftrag" }>;

/** The manifest key as install.sh left it, and whether the agent runs in test mode */
export type Vertrauen = { schluessel: OeffentlicherSchluessel; zweck: Zweck };

/** What runs: the argv of a command in a container of an installation, within a time limit */
export type Plan = {
  art: "befehl";
  aktion: string;
  installationId: string;
  container: string;
  argv: string[];
  zeitlimitMs: number;
  /** The manifest allows running it again after a restart of the agent */
  idempotent: boolean;
};

/** What a job of the Pforte does: set or remove a route through the admin API */
export type PfortePlan = {
  art: "pforte";
  aktion: string;
  auftrag: PforteAuftrag;
  zeitlimitMs: number;
  /** Setting a route replaces it, removing a missing one changes nothing: run again after a restart */
  idempotent: true;
};

export type Geprueft = { ok: true; plan: Plan | PfortePlan } | { ok: false; grund: string };

const pfortePlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = pforteAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  return {
    ok: true,
    plan: {
      art: "pforte",
      aktion: n.aktion,
      auftrag: geprueft.auftrag,
      zeitlimitMs: Math.min(n.zeitlimitS, PFORTE_ZEITLIMIT_S) * 1000,
      idempotent: true,
    },
  };
};

export const auftragPruefen = (n: AuftragNachricht, vertrauen: Vertrauen): Geprueft => {
  const vertraut = schluesselVertrauen(vertrauen.schluessel, vertrauen.zweck);
  if (!vertraut.ok) return vertraut;
  const geladen = signiertesManifestLaden(
    new TextEncoder().encode(n.manifest),
    n.signatur,
    vertrauen.schluessel,
  );
  if (!geladen.ok) return { ok: false, grund: geladen.fehler.join("; ") };
  if (istPforteAktion(n.aktion)) return pfortePlan(geladen.manifest, n);
  const befehl = befehlZurAktion(geladen.manifest, n.aktion);
  if (!befehl) return { ok: false, grund: `${n.aktion} is not a command of the manifest` };
  const gefuellt = befehlFuellen(befehl, n.argumente);
  if (!gefuellt.ok) return gefuellt;
  if (n.installationId === null || !INSTALLATIONS_NAME.test(n.installationId))
    return { ok: false, grund: "a command runs in a container of a named installation" };
  // the Zentrale may shorten the manifest's limit, never lengthen it
  const zeitlimitS = Math.min(n.zeitlimitS, befehl.zeitlimit_s ?? STANDARD_ZEITLIMIT_S);
  return {
    ok: true,
    plan: {
      art: "befehl",
      aktion: n.aktion,
      installationId: n.installationId,
      container: befehl.container,
      argv: gefuellt.argv,
      zeitlimitMs: zeitlimitS * 1000,
      idempotent: befehl.idempotent,
    },
  };
};

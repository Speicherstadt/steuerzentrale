import {
  befehlFuellen,
  befehlZurAktion,
  EINRICHTUNG_ZEITLIMIT_S,
  einrichtungAuftragPruefen,
  INSTALLATIONS_NAME,
  istEinrichtungAktion,
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
import type { Einrichten, Entfernen, Konfigurieren, Schritt } from "../einrichtung/typen.ts";
import { pruefZiel } from "../zustand/ziel.ts";

/*
 * What the agent checks before it runs anything a job asks (BAULISTE.md Z-305; docs/plan.md, "Was
 * der Agent ausführt"), in this order: the key it trusts (never the public test key outside test
 * mode), the manifest's minisign signature over its exact bytes, the action as a command of that
 * manifest, the arguments against the command's declaration. Only then is there an argv to run,
 * taken from the signed manifest. A job of the Pforte (Z-401) passes the same key and signature
 * checks, then its fixed shape (packages/manifest, pforte/auftraege.ts) instead of a command; its
 * route is rendered from the signed manifest. A setup job (Z-402) likewise, with
 * einrichtungAuftragPruefen: its units are rendered from the signed manifest, and the commands of
 * `schritte.einrichten` filled from it; reconfiguring (Z-404) alike, without them. Pure, no I/O.
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

/** What a setup job does: set up, reconfigure or tear down an installation (src/einrichtung) */
export type EinrichtungPlan = {
  art: "einrichtung";
  aktion: string;
  auftrag: Einrichten | Konfigurieren | Entfernen;
  zeitlimitMs: number;
  /**
   * Setting up and tearing down run again after a restart: the record of installations
   * (src/einrichtung/gedaechtnis.ts) tells a finished setup, and a half one is torn down before it
   * is set up anew. Reconfiguring does not: it restarts the app, and after a restart of the agent
   * that may be later than the Zentrale allowed (a freeze window); the Zentrale sends it anew
   */
  idempotent: boolean;
};

export type Geprueft =
  | { ok: true; plan: Plan | PfortePlan | EinrichtungPlan }
  | { ok: false; grund: string };

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

/** A command of `schritte.einrichten` as it runs: no arguments, its own time limit */
const schrittFuellen = (m: Manifest, name: string): Schritt | string => {
  const befehl = befehlZurAktion(m, name);
  if (!befehl) return `schritte.einrichten: ${name} is not a command of the manifest`;
  const gefuellt = befehlFuellen(befehl, {});
  if (!gefuellt.ok) return `schritte.einrichten: ${name}: ${gefuellt.grund}`;
  return {
    name,
    container: befehl.container,
    argv: gefuellt.argv,
    zeitlimitMs: (befehl.zeitlimit_s ?? STANDARD_ZEITLIMIT_S) * 1000,
  };
};

const einrichtungsAuftrag = (m: Manifest, n: AuftragNachricht) => {
  const geprueft = einrichtungAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  const a = geprueft.auftrag;
  if (a.art === "entfernen") return { ok: true as const, auftrag: a };
  // einrichtungAuftragPruefen refuses a setup without it already
  if (n.einrichtung === undefined)
    return { ok: false as const, grund: "setting up needs the installation data (einrichtung)" };
  // the health check's target from the signed manifest and the ports the job assigned (Z-403)
  const ziel = pruefZiel(m, n.einrichtung.installation);
  if (a.art === "konfigurieren") return { ok: true as const, auftrag: { ...a, ziel } };
  const schritte: Schritt[] = [];
  for (const name of a.schritte) {
    const s = schrittFuellen(m, name);
    if (typeof s === "string") return { ok: false as const, grund: s };
    schritte.push(s);
  }
  return { ok: true as const, auftrag: { ...a, schritte, ziel } };
};

const einrichtungPlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = einrichtungsAuftrag(m, n);
  if (!geprueft.ok) return geprueft;
  return {
    ok: true,
    plan: {
      art: "einrichtung",
      aktion: n.aktion,
      auftrag: geprueft.auftrag,
      zeitlimitMs: Math.min(n.zeitlimitS, EINRICHTUNG_ZEITLIMIT_S) * 1000,
      idempotent: geprueft.auftrag.art !== "konfigurieren",
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
  if (istEinrichtungAktion(n.aktion)) return einrichtungPlan(geladen.manifest, n);
  // the installation's data and its secrets belong to a setup job, and only there
  if (n.einrichtung !== undefined)
    return { ok: false, grund: "only a setup job carries installation data (einrichtung)" };
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

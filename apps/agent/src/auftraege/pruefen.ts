import {
  befehlFuellen,
  befehlZurAktion,
  INSTALLATIONS_NAME,
  type OeffentlicherSchluessel,
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
 * taken from the signed manifest. Pure, no I/O.
 */

export type AuftragNachricht = Extract<NachrichtVonDerZentrale, { typ: "auftrag" }>;

/** The manifest key as install.sh left it, and whether the agent runs in test mode */
export type Vertrauen = { schluessel: OeffentlicherSchluessel; zweck: Zweck };

/** What runs: the argv of a command in a container of an installation, within a time limit */
export type Plan = {
  aktion: string;
  installationId: string;
  container: string;
  argv: string[];
  zeitlimitMs: number;
  /** The manifest allows running it again after a restart of the agent */
  idempotent: boolean;
};

export type Geprueft = { ok: true; plan: Plan } | { ok: false; grund: string };

export const auftragPruefen = (n: AuftragNachricht, vertrauen: Vertrauen): Geprueft => {
  const vertraut = schluesselVertrauen(vertrauen.schluessel, vertrauen.zweck);
  if (!vertraut.ok) return vertraut;
  const geladen = signiertesManifestLaden(
    new TextEncoder().encode(n.manifest),
    n.signatur,
    vertrauen.schluessel,
  );
  if (!geladen.ok) return { ok: false, grund: geladen.fehler.join("; ") };
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
      aktion: n.aktion,
      installationId: n.installationId,
      container: befehl.container,
      argv: gefuellt.argv,
      zeitlimitMs: zeitlimitS * 1000,
      idempotent: befehl.idempotent,
    },
  };
};

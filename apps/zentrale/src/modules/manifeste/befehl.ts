import { readFileSync } from "node:fs";
import type { OeffentlicherSchluessel } from "@steuerzentrale/manifest";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { betreiber } from "../../db/schema.ts";
import { type Importiert, manifestImportieren } from "./importieren.ts";

/*
 * `steuerzentrale manifest importieren <pfad>` (BAULISTE.md Z-501): reads `<pfad>` and
 * `<pfad>.minisig` and imports them as the interface would, checked with the key install.sh hands
 * the agents. The person at the command is no member of an operator; a manifest holds for all of
 * them, so the import goes into every operator's audit log (akteur `befehl`). Without an operator
 * there is no audit log to write it to: the command refuses until the first owner is set up.
 */

export type BefehlErgebnis =
  | Extract<Importiert, { ok: true }>
  | { ok: false; grund: string; detail?: string };

const lesen = (pfad: string): string | undefined => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(pfad));
  } catch {
    return undefined;
  }
};

export const befehlImportieren = (
  d: { db: Db; schreibDb: SchreibDb },
  schluessel: OeffentlicherSchluessel | undefined,
  pfad: string,
  jetzt: number,
): BefehlErgebnis => {
  if (!schluessel) return { ok: false, grund: "kein_schluessel" };
  const manifest = lesen(pfad);
  if (manifest === undefined) return { ok: false, grund: "datei_fehlt", detail: pfad };
  const signatur = lesen(`${pfad}.minisig`);
  if (signatur === undefined) return { ok: false, grund: "datei_fehlt", detail: `${pfad}.minisig` };
  const [erster, ...weitere] = d.db
    .select({ id: betreiber.betreiberId })
    .from(betreiber)
    .all()
    .map((b) => b.id);
  if (!erster) return { ok: false, grund: "kein_betreiber" };
  const kontext = {
    betreiberId: erster,
    auchFuer: weitere,
    akteur: "befehl",
    jetzt,
    grund: "steuerzentrale manifest importieren",
  };
  return manifestImportieren(d, kontext, schluessel, { manifest, signatur }, "befehl");
};

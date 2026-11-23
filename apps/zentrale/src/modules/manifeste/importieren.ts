import { createHash } from "node:crypto";
import {
  type Manifest,
  manifestPruefen,
  type OeffentlicherSchluessel,
  signaturPruefen,
} from "@steuerzentrale/manifest";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { type ManifestEintrag, manifestLesen } from "./lesen.ts";

/*
 * Importing a signed manifest (BAULISTE.md Z-501; docs/plan.md, "Manifeste in der Zentrale
 * (Z-501)"): the signature of the key install.sh hands the agents over the exact bytes, then schema
 * and rules; a version is imported once and stays as it is: the same text again changes nothing,
 * another text for it is refused. Through `schreiben`, so the import stands in the audit log, the
 * text and signature there only as set.
 */

export type Eingabe = { manifest: string; signatur: string };

/** Who imported it: a member of an operator, the command, or the Zentrale from an installation */
export type Herkunft = "betreiber" | "befehl" | "uebernommen";

export type Geprueft =
  | { ok: true; manifest: Manifest }
  | { ok: false; grund: "signatur_ungueltig" | "manifest_ungueltig"; detail: string };

export type Importiert =
  | { ok: true; neu: boolean; eintrag: ManifestEintrag }
  | {
      ok: false;
      grund: "signatur_ungueltig" | "manifest_ungueltig" | "version_vergeben";
      detail?: string;
    };

/** A manifest only with a valid signature over its exact bytes, a valid schema and rules */
export const signiertesManifestPruefen = (
  schluessel: OeffentlicherSchluessel,
  eingabe: Eingabe,
): Geprueft => {
  const signiert = signaturPruefen(
    new TextEncoder().encode(eingabe.manifest),
    eingabe.signatur,
    schluessel,
  );
  if (!signiert.ok) return { ok: false, grund: "signatur_ungueltig", detail: signiert.grund };
  const geprueft = manifestPruefen(eingabe.manifest);
  return geprueft.ok
    ? geprueft
    : { ok: false, grund: "manifest_ungueltig", detail: geprueft.fehler.join("; ") };
};

export const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

export const manifestImportieren = (
  d: { db: Db; schreibDb: SchreibDb },
  kontext: Kontext,
  schluessel: OeffentlicherSchluessel,
  eingabe: Eingabe,
  herkunft: Herkunft,
): Importiert => {
  const geprueft = signiertesManifestPruefen(schluessel, eingabe);
  if (!geprueft.ok) return geprueft;
  const { id: app, version, dringend } = geprueft.manifest;
  const hash = sha256(eingabe.manifest);
  // synchronous: nothing comes between this read and the insert
  const vorhanden = manifestLesen(d.db, app, version);
  if (vorhanden)
    return vorhanden.sha256 === hash
      ? { ok: true, neu: false, eintrag: vorhanden }
      : { ok: false, grund: "version_vergeben" };
  schreiben(d.schreibDb, kontext, "manifest.importieren", (w) =>
    w.einfuegen("manifeste", {
      app,
      version,
      text: eingabe.manifest,
      signatur: eingabe.signatur,
      sha256: hash,
      dringend,
      importiertAm: kontext.jetzt,
      importiertVon: herkunft === "betreiber" ? kontext.akteur : herkunft,
      importiertVonBetreiber: herkunft === "betreiber" ? kontext.betreiberId : null,
    }),
  );
  return { ok: true, neu: true, eintrag: manifestLesen(d.db, app, version) as ManifestEintrag };
};

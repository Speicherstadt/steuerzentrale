// The manifest of an app: schema, signature, placement and rendering of Quadlet units; pure
// functions only (docs/plan.md, "Projektstruktur"; docs/manifest.md).

export {
  befehlFuellen,
  befehlZurAktion,
  type Gefuellt,
  STANDARD_ZEITLIMIT_S,
  type Wert as ArgumentWert,
} from "./befehl.ts";
export { type Geprueft, manifestPruefen, signiertesManifestLaden } from "./laden.ts";
export { type Befund, regelnPruefen } from "./pruefungen.ts";
export {
  type Argument,
  type Befehl,
  type Container,
  IMAGE,
  MAX_ZEITLIMIT_S,
  type Manifest,
  ManifestStruktur,
} from "./schema.ts";
export {
  type OeffentlicherSchluessel,
  type Signiert,
  schluesselLesen,
  signaturPruefen,
} from "./signatur.ts";

/** The manifest schema version this build reads (docs/plan.md, "Manifest": `schema: 1`) */
export const MANIFEST_SCHEMA = 1;
export {
  EINRICHTUNG_AKTIONEN,
  EINRICHTUNG_ZEITLIMIT_S,
  type Einrichtung,
  type EinrichtungAnfrage,
  type EinrichtungAuftrag,
  type EinrichtungGeprueft,
  einrichtungAuftragPruefen,
  istEinrichtungAktion,
} from "./einrichtung/auftraege.ts";
export { manifestJsonSchema } from "./json-schema.ts";
export {
  istPforteAktion,
  PFORTE_AKTIONEN,
  PFORTE_PORT,
  PFORTE_ZEITLIMIT_S,
  type PforteAnfrage,
  type PforteAuftrag,
  type PforteGeprueft,
  pforteAuftragPruefen,
} from "./pforte/auftraege.ts";
export {
  GRUND_ID,
  PFORTE_ADMIN_IM_CONTAINER,
  PFORTE_SERVER,
  type PforteGrund,
  type PforteOptionen,
  pforteGrundkonfiguration,
  UNBEKANNT_ID,
} from "./pforte/grund.ts";
export { PFORTE_ADMIN_VERZEICHNIS, PFORTE_UNIT, pforteUnit } from "./pforte/unit.ts";
export {
  type Befund as PlatzBefund,
  festePorts,
  type PlatzAnfrage,
  type PlatzInstallation,
  type Platzierung,
  type PlatzKunde,
  type PlatzServer,
  platzieren,
  ramBedarf,
  WARNSCHWELLE,
} from "./platzierung.ts";
export { INSTALLATIONS_NAME } from "./quadlet/eingabe.ts";
export { type PforteRoute, STREAM_SCHLIESSEN_NACH } from "./quadlet/pforte.ts";
export { quadletsRendern } from "./quadlet/rendern.ts";
export { PODMAN_4_9_SCHLUESSEL } from "./quadlet/schluessel.ts";
export { type Abschnitt, systemdWort, unitLesen } from "./quadlet/systemd.ts";
export {
  DATEIEN_VERZEICHNIS,
  type Gerendert,
  type QuadletAnfrage,
  type QuadletEinstellungen,
  type QuadletInstallation,
  type Quadlets,
  type Wert,
} from "./quadlet/typen.ts";
export { PFORTE_IMAGE, type SystemImage } from "./system.ts";
export { schluesselVertrauen, TEST_SCHLUESSEL_ID, type Zweck } from "./vertrauen.ts";

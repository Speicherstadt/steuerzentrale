// The manifest of an app: schema, signature, placement and rendering of Quadlet units; pure
// functions only (docs/plan.md, "Projektstruktur"; docs/manifest.md).

export { type Geprueft, manifestPruefen, signiertesManifestLaden } from "./laden.ts";
export { type Befund, regelnPruefen } from "./pruefungen.ts";
export { type Container, IMAGE, type Manifest, ManifestStruktur } from "./schema.ts";
export {
  type OeffentlicherSchluessel,
  type Signiert,
  schluesselLesen,
  signaturPruefen,
} from "./signatur.ts";

/** The manifest schema version this build reads (docs/plan.md, "Manifest": `schema: 1`) */
export const MANIFEST_SCHEMA = 1;
export { manifestJsonSchema } from "./json-schema.ts";
export { schluesselVertrauen, TEST_SCHLUESSEL_ID, type Zweck } from "./vertrauen.ts";

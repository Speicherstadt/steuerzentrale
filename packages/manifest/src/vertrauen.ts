import { type OeffentlicherSchluessel, schluesselLesen } from "./signatur.ts";

/**
 * The public test key in test/schluessel/ (docs/plan.md, "Signaturen in Tests"): CI signs the
 * example app's manifests and release candidates with it. Whoever has the repository has its
 * secret half, so a release build and an agent outside tests must never trust it.
 */
export const TEST_SCHLUESSEL_ID = "3D1586A2B972C948";
// The key line of test/schluessel/test.pub. Its secret half signs under any key id
// (scripts/minisign.ts), so the key bytes identify it, not only the id
const TEST_SCHLUESSEL = schluesselLesen("RWRIyXK5ooYVPbx8wak0UtxTTy6wWLdKm1lGfSg8ZJudL8LJxj7pxXFU");

export type Zweck = "release" | "test";

const istTestSchluessel = (schluessel: OeffentlicherSchluessel): boolean =>
  schluessel.id === TEST_SCHLUESSEL_ID ||
  (TEST_SCHLUESSEL !== undefined &&
    schluessel.schluessel.length === TEST_SCHLUESSEL.schluessel.length &&
    schluessel.schluessel.every((b, i) => b === TEST_SCHLUESSEL.schluessel[i]));

export const schluesselVertrauen = (
  schluessel: OeffentlicherSchluessel,
  zweck: Zweck,
): { ok: true } | { ok: false; grund: string } =>
  zweck === "release" && istTestSchluessel(schluessel)
    ? {
        ok: false,
        grund: `key ${TEST_SCHLUESSEL_ID} is the public test key; a release never trusts it`,
      }
    : { ok: true };

import type { OeffentlicherSchluessel } from "./signatur.ts";

/**
 * The public test key in test/schluessel/ (docs/plan.md, "Signaturen in Tests"): CI signs the
 * example app's manifests and release candidates with it. Whoever has the repository has its
 * secret half, so a release build and an agent outside tests must never trust it.
 */
export const TEST_SCHLUESSEL_ID = "3D1586A2B972C948";

export type Zweck = "release" | "test";

export const schluesselVertrauen = (
  schluessel: OeffentlicherSchluessel,
  zweck: Zweck,
): { ok: true } | { ok: false; grund: string } =>
  zweck === "release" && schluessel.id === TEST_SCHLUESSEL_ID
    ? {
        ok: false,
        grund: `key ${TEST_SCHLUESSEL_ID} is the public test key; a release never trusts it`,
      }
    : { ok: true };

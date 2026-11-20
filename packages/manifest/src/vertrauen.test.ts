import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schluesselLesen } from "./signatur.ts";
import { schluesselVertrauen, TEST_SCHLUESSEL_ID } from "./vertrauen.ts";

const testSchluessel = () => {
  const s = schluesselLesen(
    readFileSync(join(import.meta.dirname, "../../../test/schluessel/test.pub"), "utf8"),
  );
  if (!s) throw new Error("test key");
  return s;
};

describe("trusting a key", () => {
  it("names the id of the key in test/schluessel/", () => {
    expect(testSchluessel().id).toBe(TEST_SCHLUESSEL_ID);
  });

  it("refuses the test key for a release", () => {
    expect(schluesselVertrauen(testSchluessel(), "release")).toEqual({
      ok: false,
      grund: `key ${TEST_SCHLUESSEL_ID} is the public test key; a release never trusts it`,
    });
  });

  it("takes the test key in tests and any other key for a release", () => {
    expect(schluesselVertrauen(testSchluessel(), "test")).toEqual({ ok: true });
    expect(
      schluesselVertrauen({ id: "0123456789ABCDEF", schluessel: new Uint8Array(32) }, "release"),
    ).toEqual({ ok: true });
  });
});

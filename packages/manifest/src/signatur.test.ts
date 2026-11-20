import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signiertesManifestLaden } from "./laden.ts";
import { schluesselLesen, signaturPruefen } from "./signatur.ts";

// Reference signatures made with minisign 0.11 and the public test key (test/schluessel/README.md):
// `minisign -S` (prehashed "ED") and `minisign -S -l` (legacy "Ed")
const lesen = (datei: string) => readFileSync(join(import.meta.dirname, "../test", datei));
const text = (datei: string) => lesen(datei).toString("utf8");
const testSchluessel = () => {
  const schluessel = schluesselLesen(
    readFileSync(join(import.meta.dirname, "../../../test/schluessel/test.pub"), "utf8"),
  );
  if (!schluessel) throw new Error("test key");
  return schluessel;
};

describe("schluesselLesen", () => {
  it("reads a minisign public key file with its id", () => {
    expect(testSchluessel().id).toBe("3D1586A2B972C948");
  });

  it("refuses anything else", () => {
    expect(schluesselLesen("untrusted comment: x\nkeinschluessel")).toBeUndefined();
    expect(schluesselLesen("")).toBeUndefined();
  });
});

describe("signaturPruefen", () => {
  it("accepts a prehashed minisign signature with its trusted comment", () => {
    expect(
      signaturPruefen(lesen("signiert.yml"), text("signiert.yml.minisig"), testSchluessel()),
    ).toEqual({
      ok: true,
      schluesselId: "3D1586A2B972C948",
      kommentar: "manifest beispiel",
    });
  });

  it("accepts a legacy signature", () => {
    expect(
      signaturPruefen(lesen("legacy.yml"), text("legacy.yml.minisig"), testSchluessel()).ok,
    ).toBe(true);
  });

  it("refuses a changed file", () => {
    const geaendert = new Uint8Array([...lesen("signiert.yml"), 0x0a]);
    expect(signaturPruefen(geaendert, text("signiert.yml.minisig"), testSchluessel())).toEqual({
      ok: false,
      grund: "signature does not match",
    });
  });

  it("refuses a changed trusted comment", () => {
    const signatur = text("signiert.yml.minisig").replace("manifest beispiel", "manifest anders");
    expect(signaturPruefen(lesen("signiert.yml"), signatur, testSchluessel()).ok).toBe(false);
  });

  it("refuses another key", () => {
    const anderer = { ...testSchluessel(), id: "0000000000000001" };
    expect(signaturPruefen(lesen("signiert.yml"), text("signiert.yml.minisig"), anderer).ok).toBe(
      false,
    );
    const fremd = { id: testSchluessel().id, schluessel: new Uint8Array(32).fill(1) };
    expect(signaturPruefen(lesen("signiert.yml"), text("signiert.yml.minisig"), fremd).ok).toBe(
      false,
    );
  });

  it("refuses a missing or broken signature", () => {
    expect(signaturPruefen(lesen("signiert.yml"), "", testSchluessel()).ok).toBe(false);
    expect(
      signaturPruefen(lesen("signiert.yml"), "untrusted comment: x\n!!!\n", testSchluessel()).ok,
    ).toBe(false);
  });
});

describe("signiertesManifestLaden", () => {
  // test/beispiel.yml is the example of docs/plan.md, signed with minisign and the test key
  it("loads a signed, valid manifest", () => {
    const geladen = signiertesManifestLaden(
      lesen("beispiel.yml"),
      text("beispiel.yml.minisig"),
      testSchluessel(),
    );
    expect(geladen.ok && geladen.manifest.id).toBe("haben");
  });

  it("refuses an unsigned manifest", () => {
    expect(signiertesManifestLaden(lesen("beispiel.yml"), undefined, testSchluessel())).toEqual({
      ok: false,
      fehler: ["(signature): the manifest is not signed"],
    });
  });

  it("refuses a changed manifest before reading it", () => {
    const geaendert = new TextEncoder().encode(
      text("beispiel.yml").replace("ram_mb: 2048", "ram_mb: 8192"),
    );
    expect(
      signiertesManifestLaden(geaendert, text("beispiel.yml.minisig"), testSchluessel()),
    ).toEqual({
      ok: false,
      fehler: ["(signature): signature does not match"],
    });
  });

  it("refuses a validly signed manifest that breaks the schema", () => {
    const geladen = signiertesManifestLaden(
      lesen("signiert.yml"),
      text("signiert.yml.minisig"),
      testSchluessel(),
    );
    expect(geladen.ok).toBe(false);
  });
});

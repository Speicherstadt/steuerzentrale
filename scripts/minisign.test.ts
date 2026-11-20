import { readFileSync } from "node:fs";
import { join } from "node:path";
import { schluesselLesen, signaturPruefen } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { geheimenSchluesselLesen, signieren } from "./minisign.ts";

const root = join(import.meta.dirname, "..");
const lesen = (pfad: string) => readFileSync(join(root, pfad), "utf8");

describe("signing with the test key", () => {
  it("makes signatures the verifier of packages/manifest accepts", () => {
    const inhalt = new TextEncoder().encode("schema: 1\nid: beispiel\n");
    const signatur = signieren(
      inhalt,
      geheimenSchluesselLesen(lesen("test/schluessel/test.key")),
      "beispiel 1.0.0",
    );
    const oeffentlich = schluesselLesen(lesen("test/schluessel/test.pub"));
    if (!oeffentlich) throw new Error("test key");
    expect(signaturPruefen(inhalt, signatur, oeffentlich)).toEqual({
      ok: true,
      schluesselId: "3D1586A2B972C948",
      kommentar: "beispiel 1.0.0",
    });
  });

  it("signs exactly what minisign signs (same key, same file, same signature)", () => {
    // Ed25519 is deterministic: minisign 0.11 made packages/manifest/test/signiert.yml.minisig
    const inhalt = readFileSync(join(root, "packages/manifest/test/signiert.yml"));
    const signatur = signieren(
      inhalt,
      geheimenSchluesselLesen(lesen("test/schluessel/test.key")),
      "manifest beispiel",
    );
    const minisign = lesen("packages/manifest/test/signiert.yml.minisig").split("\n");
    expect(signatur.split("\n").slice(1, 4)).toEqual(minisign.slice(1, 4));
  });

  it("refuses an encrypted secret key and a comment over two lines", () => {
    const verschluesselt = Buffer.from(
      lesen("test/schluessel/test.key").split("\n")[1] ?? "",
      "base64",
    );
    verschluesselt[2] = 0x53;
    expect(() =>
      geheimenSchluesselLesen(`untrusted comment: x\n${verschluesselt.toString("base64")}\n`),
    ).toThrow("encrypted");
    expect(() =>
      signieren(
        new Uint8Array(),
        geheimenSchluesselLesen(lesen("test/schluessel/test.key")),
        "a\nb",
      ),
    ).toThrow();
  });
});

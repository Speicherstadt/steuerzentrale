import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { releaseSchluesselPruefen } from "./release-schluessel.ts";

const root = join(import.meta.dirname, "..");

describe("a release build", () => {
  it("refuses the public test key", () => {
    expect(
      releaseSchluesselPruefen(readFileSync(join(root, "test/schluessel/test.pub"), "utf8")),
    ).toMatchObject({ ok: false, grund: expect.stringContaining("test key") });
  });

  it("fails as a command for the test key", () => {
    const lauf = Bun.spawnSync([
      "bun",
      join(root, "scripts/release-schluessel.ts"),
      join(root, "test/schluessel/test.pub"),
    ]);
    expect(lauf.exitCode).toBe(1);
  });

  it("takes another key and refuses something that is no key", () => {
    // A key made for this test only: "Ed", key id, 32 key bytes
    const anderer = Buffer.from([
      0x45,
      0x64,
      ...new Array(8).fill(1),
      ...new Array(32).fill(2),
    ]).toString("base64");
    expect(releaseSchluesselPruefen(`untrusted comment: x\n${anderer}\n`)).toEqual({
      ok: true,
      id: "0101010101010101",
    });
    expect(releaseSchluesselPruefen("kein schlüssel")).toEqual({
      ok: false,
      grund: "no minisign public key",
    });
  });
});

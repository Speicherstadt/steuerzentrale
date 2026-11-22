import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { echteHausDateien } from "./echt.ts";

/*
 * Z-404: before reconfiguring, root reads the old files in the user's home back (konfigurieren.ts).
 * The home belongs to the user, so a symlink there must never make root read a file elsewhere.
 */
const ordner = mkdtempSync(join(tmpdir(), "sz-test-haus-"));
afterAll(() => rmSync(ordner, { recursive: true, force: true }));

describe("reading a file in a user's home", () => {
  it("reads a regular file", async () => {
    writeFileSync(join(ordner, "unit"), "[Unit]\n");
    expect(await echteHausDateien.dateiLesen(join(ordner, "unit"))).toBe("[Unit]\n");
  });

  it("answers undefined for a missing file", async () => {
    expect(await echteHausDateien.dateiLesen(join(ordner, "fehlt"))).toBeUndefined();
  });

  it("refuses a symlink instead of following it", async () => {
    writeFileSync(join(ordner, "fremd"), "geheim");
    symlinkSync(join(ordner, "fremd"), join(ordner, "link"));
    await expect(echteHausDateien.dateiLesen(join(ordner, "link"))).rejects.toThrow("ELOOP");
  });

  it("refuses a folder", async () => {
    mkdirSync(join(ordner, "ordner"));
    await expect(echteHausDateien.dateiLesen(join(ordner, "ordner"))).rejects.toThrow(
      "not a regular file",
    );
  });
});

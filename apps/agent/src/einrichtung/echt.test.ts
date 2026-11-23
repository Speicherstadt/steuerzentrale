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

/*
 * Z-503: before an update, root lists the units of the user's home and removes those the new
 * version no longer has. A symlink there is removed itself, never what it points to.
 */
describe("listing and removing in a user's home", () => {
  const unten = join(ordner, "liste");

  it("lists a folder's entries sorted, and none for a missing folder", async () => {
    mkdirSync(unten);
    writeFileSync(join(unten, "b.container"), "");
    writeFileSync(join(unten, "a.network"), "");
    expect(await echteHausDateien.dateienIn(unten)).toEqual(["a.network", "b.container"]);
    expect(await echteHausDateien.dateienIn(join(ordner, "fehlt-auch"))).toEqual([]);
  });

  it("refuses to list a symlink to a folder", async () => {
    symlinkSync(unten, join(ordner, "liste-link"));
    await expect(echteHausDateien.dateienIn(join(ordner, "liste-link"))).rejects.toThrow(
      "not a folder",
    );
  });

  it("removes a file, a symlink without its target, and a missing one without error", async () => {
    writeFileSync(join(ordner, "ziel"), "bleibt");
    symlinkSync(join(ordner, "ziel"), join(unten, "c.container"));
    await echteHausDateien.entfernen(join(unten, "c.container"));
    await echteHausDateien.entfernen(join(unten, "a.network"));
    await echteHausDateien.entfernen(join(unten, "fehlt"));
    expect(await echteHausDateien.dateienIn(unten)).toEqual(["b.container"]);
    expect(await echteHausDateien.dateiLesen(join(ordner, "ziel"))).toBe("bleibt");
  });

  it("refuses to remove a folder", async () => {
    await expect(echteHausDateien.entfernen(unten)).rejects.toThrow();
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { webDatei } from "./index.ts";

/*
 * BAULISTE.md Z-1004: the Zentrale's image serves the built interface (apps/web/dist) from
 * STEUERZENTRALE_WEB; a path of the SPA's router gets index.html, a missing asset 404, and nothing
 * outside the folder is ever read.
 */
const aussen = mkdtempSync(join(tmpdir(), "sz-test-web-"));
const ordner = join(aussen, "web");
afterAll(() => rmSync(aussen, { recursive: true, force: true }));
mkdirSync(join(ordner, "assets"), { recursive: true });
writeFileSync(join(ordner, "index.html"), "<!doctype html>");
writeFileSync(join(ordner, "assets", "app-1.js"), "x");
writeFileSync(join(aussen, "geheim.txt"), "geheim");

describe("the interface's files", () => {
  it("serves a file of the folder", () => {
    expect(webDatei(ordner, "/assets/app-1.js")).toBe(join(ordner, "assets", "app-1.js"));
    expect(webDatei(ordner, "/")).toBe(join(ordner, "index.html"));
  });

  it("answers a route of the SPA with index.html, a missing file with nothing", () => {
    expect(webDatei(ordner, "/erster-inhaber")).toBe(join(ordner, "index.html"));
    expect(webDatei(ordner, "/server/s1")).toBe(join(ordner, "index.html"));
    expect(webDatei(ordner, "/assets/fehlt.js")).toBeUndefined();
  });

  it("never reads outside the folder and leaves the API's paths alone", () => {
    for (const pfad of [
      "/../geheim.txt",
      "/%2e%2e/geheim.txt",
      "/assets/..%2f..%2fgeheim.txt",
      "/api/v1/unbekannt",
      "/api/auth/x",
      "/agent/steuerzentrale-agent-linux-x64",
      "/%",
    ])
      expect(webDatei(ordner, pfad)).toBeUndefined();
  });
});

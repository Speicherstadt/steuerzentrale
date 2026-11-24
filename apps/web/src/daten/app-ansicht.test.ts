import { describe, expect, it } from "vitest";
import { appHinweis, neuesteVersion } from "./app-ansicht.ts";
import type { AppDerZentrale, AppVersion } from "./apps.ts";
import type { Manifest } from "./typen.ts";

// The one hint of a tile on the page Apps, and its version
const version = (v: string, extra: Partial<AppVersion> = {}): AppVersion => ({
  version: v,
  zustand: "verfuegbar",
  dringend: false,
  vorabversion: false,
  sha256: null,
  importiert: null,
  ...extra,
});
const app = (...versionen: AppVersion[]): AppDerZentrale => ({
  app: "x",
  versionen,
  registry: null,
});
const mitSperrzeit = { sperrzeiten: [{ von: 1, bis: 3, grund: "Monatsabschluss" }] } as Manifest;
// 2026-11-02 12:00 in Berlin lies inside days 1 to 3, 2026-11-10 outside
const am2 = Date.UTC(2026, 10, 2, 11);
const am10 = Date.UTC(2026, 10, 10, 11);

describe("neuesteVersion", () => {
  it("is the newest imported release, a pre-release only when nothing else is there", () => {
    const vorab = version("2.0.0-rc.1", { vorabversion: true });
    expect(neuesteVersion(app(vorab, version("1.0.0")))).toBe("1.0.0");
    expect(neuesteVersion(app(vorab))).toBe("2.0.0-rc.1");
    expect(neuesteVersion(app(version("1.1.0", { zustand: "manifest_fehlt" })))).toBeUndefined();
    expect(neuesteVersion(undefined)).toBeUndefined();
  });
});

describe("appHinweis", () => {
  const neu = app(version("1.1.0", { zustand: "manifest_fehlt" }), version("1.0.0"));
  it("names a freeze window that holds first", () => {
    expect(appHinweis(mitSperrzeit, neu, [], am2)).toEqual({ art: "sperrzeit", bis: 3 });
  });
  it("then a newer version whose manifest is missing", () => {
    expect(appHinweis(mitSperrzeit, neu, [], am10)).toEqual({
      art: "manifest_fehlt",
      version: "1.1.0",
    });
  });
  it("then installations behind the newest version", () => {
    expect(appHinweis(undefined, app(version("1.2.0")), ["1.0.0", "1.2.0"], am10)).toEqual({
      art: "update",
      version: "1.2.0",
      n: 1,
    });
  });
  it("is nothing when all is current", () => {
    expect(appHinweis(undefined, app(version("1.2.0")), ["1.2.0"], am10)).toBeUndefined();
    expect(appHinweis(undefined, undefined, ["1.0.0"], am10)).toBeUndefined();
  });
});

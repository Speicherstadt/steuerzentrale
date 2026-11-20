import { describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import { berlin } from "../demo/zeit.ts";
import {
  installationVon,
  istAktuell,
  istGekuendigt,
  kundenAuf,
  monatVon,
  ramVergebenMb,
  sperrzeitAktiv,
  sperrzeitenAuf,
  supportMinuten,
  titel,
} from "./ableitungen.ts";

const haben = { von: 7, bis: 12, grund: "" };

describe("derived facts", () => {
  it("names an installation by customer and app", () => {
    expect(titel(demo, installationVon(demo, "lind-haben"))).toBe("Studio Lind · Haben");
  });

  it("knows an installation on the newest signed version", () => {
    expect(istAktuell(demo, installationVon(demo, "atelier-haben"))).toBe(true);
    expect(istAktuell(demo, installationVon(demo, "roth-haben"))).toBe(false);
  });

  it("marks installations of a cancelled customer", () => {
    expect(istGekuendigt(demo, installationVon(demo, "sonne-haben"))).toBe(true);
    expect(istGekuendigt(demo, installationVon(demo, "aust-haben"))).toBe(false);
  });

  it("holds a monthly freeze window from its first to its last day in Berlin", () => {
    expect(sperrzeitAktiv(haben, berlin("2026-12-06", "23:59"))).toBe(false);
    expect(sperrzeitAktiv(haben, berlin("2026-12-07", "00:00"))).toBe(true);
    expect(sperrzeitAktiv(haben, berlin("2026-12-12", "23:59"))).toBe(true);
    expect(sperrzeitAktiv(haben, berlin("2026-12-13", "00:00"))).toBe(false);
  });

  it("counts the freeze windows of the apps on a server only", () => {
    expect(sperrzeitenAuf(demo, "shared-1").map((z) => z.app)).toEqual(["haben"]);
    expect(sperrzeitenAuf(demo, "kraft")).toEqual([]);
  });

  it("lists each customer of a server once", () => {
    const namen = kundenAuf(demo, "shared-1").map((k) => k.id);
    expect(namen).toEqual([...new Set(namen)]);
    expect(namen).toContain("atelier-nord");
  });

  it("sums the RAM limits of a server's manifests", () => {
    // Haben 2048 + Belegt 2048 on the customer's own server
    expect(ramVergebenMb(demo, "holm")).toBe(4096);
  });

  it("sums support minutes per customer and Berlin month", () => {
    expect(supportMinuten(demo, "studio-lind", "2026-11")).toBe(44);
    expect(supportMinuten(demo, "atelier-nord", "2026-10")).toBe(25);
    expect(supportMinuten(demo, "atelier-nord", "2026-11")).toBe(0);
  });

  it("takes the month in Berlin, not in UTC", () => {
    // 30.11.2026 23:30 UTC is already December in Berlin
    expect(monatVon(Date.UTC(2026, 10, 30, 23, 30))).toBe("2026-12");
  });
});

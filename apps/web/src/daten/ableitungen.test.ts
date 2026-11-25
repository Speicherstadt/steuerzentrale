import { describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import { berlin } from "../demo/zeit.ts";
import {
  installationVon,
  istGekuendigt,
  monatVon,
  ramDerMb,
  sperrzeitAktiv,
  sperrzeitenDer,
  titel,
} from "./ableitungen.ts";

const haben = { von: 7, bis: 12, grund: "" };

describe("derived facts", () => {
  it("names an installation by customer and app", () => {
    expect(titel(demo, installationVon(demo, "lind-haben"))).toBe("Studio Lind · Haben");
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

  it("counts the freeze windows of the installed apps only (Z-406)", () => {
    expect(sperrzeitenDer(demo, ["haben", "belegt", "haben"]).map((z) => z.app)).toEqual(["haben"]);
    expect(sperrzeitenDer(demo, ["fixpunkt"])).toEqual([]);
  });

  it("sums the RAM limits of the installed apps' manifests, an unknown app as none", () => {
    // Haben 2048 + Belegt 2048, as on the customer's own server
    expect(ramDerMb(demo, ["haben", "belegt", "probe"])).toBe(4096);
  });

  it("takes the month in Berlin, not in UTC", () => {
    // 30.11.2026 23:30 UTC is already December in Berlin
    expect(monatVon(Date.UTC(2026, 10, 30, 23, 30))).toBe("2026-12");
  });
});

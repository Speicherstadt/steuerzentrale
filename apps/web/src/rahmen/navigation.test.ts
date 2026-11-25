import { setLocale } from "@steuerzentrale/ui";
import { beforeEach, describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import { GRUPPEN, heimat, pfadStufen, sichtbareGruppen } from "./navigation.ts";

const namen = (gruppen = GRUPPEN) =>
  gruppen.map((g) => [g.name(), g.bereiche.map((b) => b.name())]);

describe("navigation", () => {
  beforeEach(() => setLocale("de", { reload: false }));

  // docs/plan.md, "Navigation (Oberfläche 2026-11)": eight entries, one home per thing
  it("has exactly eight areas in the groups Betrieb and Verwaltung", () => {
    expect(namen()).toEqual([
      ["Betrieb", ["Übersicht", "Apps", "Server", "Kunden", "Updates"]],
      ["Verwaltung", ["Katalog", "Protokoll", "Einstellungen"]],
    ]);
    expect(GRUPPEN.flatMap((g) => g.bereiche.map((b) => b.pfad))).toEqual([
      "/",
      "/apps",
      "/server",
      "/kunden",
      "/updates",
      "/katalog",
      "/protokoll",
      "/einstellungen",
    ]);
  });

  it("counts what needs attention on the overview and the updates", () => {
    const zaehler = Object.fromEntries(
      GRUPPEN.flatMap((g) => g.bereiche).map((b) => [b.pfad, b.zaehler]),
    );
    expect(zaehler["/"]).toBe("aufmerksamkeit");
    expect(zaehler["/updates"]).toBe("updates");
    expect(Object.values(zaehler).filter(Boolean)).toHaveLength(2);
  });

  it('hides Kunden in "Nur für mich" (Z-805)', () => {
    expect(namen(sichtbareGruppen(GRUPPEN, true))).toEqual([
      ["Betrieb", ["Übersicht", "Apps", "Server", "Updates"]],
      ["Verwaltung", ["Katalog", "Protokoll", "Einstellungen"]],
    ]);
    expect(namen(sichtbareGruppen(GRUPPEN, false))).toEqual(namen());
  });

  it("finds the area of every page, also of a page without an entry", () => {
    expect(heimat("/")).toBe("/");
    expect(heimat("/apps/lind-haben")).toBe("/apps");
    expect(heimat("/backups")).toBe("/apps");
    expect(heimat("/katalog/haben")).toBe("/katalog");
    expect(heimat("/protokoll")).toBe("/protokoll");
  });

  it("shows the area alone on a list page", () => {
    expect(pfadStufen(demo, "/")).toEqual([{ name: "Übersicht" }]);
    expect(pfadStufen(demo, "/updates")).toEqual([{ name: "Updates" }]);
    expect(pfadStufen(demo, "/apps")).toEqual([{ name: "Apps" }]);
    expect(pfadStufen(demo, "/katalog")).toEqual([{ name: "Katalog" }]);
    expect(pfadStufen(demo, "/protokoll")).toEqual([{ name: "Protokoll" }]);
  });

  it("shows the object below its area on a detail page", () => {
    expect(pfadStufen(demo, "/server/shared-1")).toEqual([
      { name: "Server", pfad: "/server" },
      { name: "Gemeinsamer Server 1" },
    ]);
    expect(pfadStufen(demo, "/apps/lind-haben")).toEqual([
      { name: "Apps", pfad: "/apps" },
      { name: "Haben · Studio Lind" },
    ]);
    expect(pfadStufen(demo, "/katalog/haben")).toEqual([
      { name: "Katalog", pfad: "/katalog" },
      { name: "Haben" },
    ]);
    expect(pfadStufen(demo, "/kunden/roth")[1]).toEqual({ name: "Übersetzungen Roth" });
  });

  it("shows a page without an entry below its area", () => {
    expect(pfadStufen(demo, "/backups")).toEqual([
      { name: "Apps", pfad: "/apps" },
      { name: "Backups" },
    ]);
  });

  it("falls back to the area for an unknown object", () => {
    expect(pfadStufen(demo, "/server/gibt-es-nicht")).toEqual([{ name: "Server" }]);
  });
});

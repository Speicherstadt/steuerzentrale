import { setLocale } from "@steuerzentrale/ui";
import { beforeEach, describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import { GRUPPEN, pfadStufen } from "./navigation.ts";

describe("navigation", () => {
  beforeEach(() => setLocale("de", { reload: false }));

  it("has the groups Betrieb, Kunden and System (DESIGN.md)", () => {
    expect(GRUPPEN.map((g) => g.name())).toEqual(["Betrieb", "Kunden", "System"]);
    expect(GRUPPEN.flatMap((g) => g.bereiche).map((b) => b.pfad)).toHaveLength(13);
  });

  it("shows the area alone on a list page", () => {
    expect(pfadStufen(demo, "/")).toEqual([{ name: "Übersicht" }]);
    expect(pfadStufen(demo, "/updates")).toEqual([{ name: "Updates" }]);
  });

  it("shows the object below its area on a detail page", () => {
    expect(pfadStufen(demo, "/server/shared-1")).toEqual([
      { name: "Server", pfad: "/server" },
      { name: "Gemeinsamer Server 1" },
    ]);
    expect(pfadStufen(demo, "/installationen/lind-haben")).toEqual([
      { name: "Installationen", pfad: "/installationen" },
      { name: "Studio Lind · Haben" },
    ]);
    expect(pfadStufen(demo, "/kunden/roth")[1]).toEqual({ name: "Übersetzungen Roth" });
  });

  it("falls back to the area for an unknown object", () => {
    expect(pfadStufen(demo, "/server/gibt-es-nicht")).toEqual([{ name: "Server" }]);
  });
});

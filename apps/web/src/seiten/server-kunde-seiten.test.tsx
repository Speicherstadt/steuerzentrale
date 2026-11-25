import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aufraeumen, knopf, oeffne, reiterWaehlen, warten } from "./test-dom.tsx";

// docs/plan.md, "Server und Kunden (Oberfläche 2026-11)": the page "Server" as one table, the page
// of a server and of a customer with their tabs, against the demo's sources, which answer as the
// Zentrale's API does
beforeEach(() => {
  setLocale("de", { reload: false });
});
afterEach(aufraeumen);

const spalten = (root: HTMLElement) =>
  [...root.querySelectorAll("main thead th")].map((th) => th.textContent);

const reiter = (root: HTMLElement) =>
  [...root.querySelectorAll('main [role="tab"]')].map((t) => t.textContent);

const text = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";

describe("the page Server", () => {
  it("marks a server that is only observed and offers no reboot there (Z-1102)", async () => {
    const { root } = await oeffne("/server/bestand");
    await warten();
    expect(root.querySelector("main h1")?.parentElement?.textContent).toContain("nur beobachtet");
    expect(knopf(root, "Neu starten")).toBeUndefined();
  });

  it("lists every server in one table, what needs attention first, each row a link", async () => {
    const { root } = await oeffne("/server");
    await warten();
    expect(spalten(root)).toEqual(["Server", "Zustand", "CPU", "RAM", "Platte", "Apps", "System"]);
    const zeilen = [...root.querySelectorAll<HTMLTableRowElement>("main tbody tr")];
    expect(zeilen.map((z) => z.querySelector("a")?.getAttribute("href"))).toEqual([
      "/server/lind",
      "/server/kraft",
      "/server/shared-2",
      "/server/holm",
      "/server/bestand",
      "/server/shared-1",
    ]);
    expect(zeilen[0]?.textContent).toContain("Server 3");
    expect(zeilen[0]?.textContent).not.toContain("eigener Server eines Kunden");
    expect(zeilen[0]?.textContent).toContain("Platte fast voll");
    expect(zeilen[0]?.textContent).toContain("91 %");
    expect(zeilen[1]?.textContent).toContain("meldet sich nicht, zuletzt vor 6 Min.");
    expect(zeilen[2]?.textContent).toMatch(/Neustart nötig, geplant /);
    expect(zeilen[4]?.textContent).not.toContain("für mehrere Kunden");
    expect(zeilen[4]?.textContent).toContain("verbunden");
    expect(zeilen[4]?.textContent).toMatch(/\d+ Apps · \d+ Kunden/);
    expect(zeilen[4]?.textContent).toContain("Debian 13");
  });
});

describe("the page of a server", () => {
  it("heads with its name, no kind (Z-1205), its state in a sentence and its tabs in the URL", async () => {
    const { root, router } = await oeffne("/server/shared-1");
    expect(root.querySelector("main h1")?.textContent).toBe("Server 1");
    expect(root.querySelector("main")?.textContent).not.toContain("für mehrere Kunden");
    expect(root.textContent).toContain("Verbunden, alles in Ordnung");
    expect(root.textContent).toContain("203.0.113.11");
    expect(knopf(root, "Neu starten")).toBeDefined();
    expect(reiter(root)).toEqual([
      "Überblick",
      "Auslastung",
      expect.stringMatching(/^Apps \d+$/),
      "Verlauf",
      "Technik",
    ]);
    await reiterWaehlen(root, "Technik");
    expect(router.state.location.search).toEqual({ tab: "technik" });
    expect(root.textContent).toContain("netcup RS 4000");
  });

  it("shows five rows on Überblick, the first apps and the newest events", async () => {
    const { root } = await oeffne("/server/shared-1");
    expect(text(root, "auslastung")).toContain("vom Agenten, verbunden");
    expect(text(root, "auslastung")).toContain("47 %");
    expect(text(root, "system")).toContain(
      "Debian 13 · Sicherheitsupdates aktuell · kein Neustart nötig",
    );
    expect(text(root, "wartung")).toContain("Wartungsfenster täglich 03:30–04:30");
    expect(text(root, "pruefungen")).toMatch(/\d+ von \d+ in Ordnung: Platte, Zertifikate/);
    expect(text(root, "agent")).toContain("Agent 0.5.0");
    expect(text(root, "agent")).toContain("Zertifikat bis");
    const apps = root.querySelectorAll("[data-testid=apps-hier] li");
    expect(apps.length).toBeLessThanOrEqual(4);
    const alle = [...root.querySelectorAll("main a")].find((a) =>
      a.textContent?.startsWith("Alle "),
    );
    expect(alle?.getAttribute("href")).toBe("/server/shared-1?tab=apps");
    expect(root.querySelector("[data-testid=zuletzt]")).not.toBeNull();
  });

  it("names what a check found on Überblick", async () => {
    const { root } = await oeffne("/server/lind");
    expect(text(root, "pruefungen")).toContain("Platte: 91 % belegt (Grenze 90 %)");
    expect(text(root, "pruefungen")).toContain("Prüfen");
  });

  it("shows the disk, CPU, memory and load over time on Auslastung (Z-1106)", async () => {
    const { root } = await oeffne("/server/shared-1?tab=auslastung");
    await warten();
    expect(text(root, "platte-/")).toContain("Platte");
    expect(text(root, "platte-/")).toContain("47 %");
    expect(root.querySelectorAll("[data-testid=linie]")).toHaveLength(4);
    expect(text(root, "last-cpu")).toContain("CPU");
    expect(text(root, "last-ram")).toContain("RAM");
    expect(text(root, "last-load")).toContain("Last");
    // 7 days a point every four hours, 24 hours a point each hour
    const punkte = () =>
      root.querySelector("[data-testid=linie] polyline")?.getAttribute("points")?.split(" ").length;
    expect(punkte()).toBe(42);
    [...root.querySelectorAll<HTMLButtonElement>("main fieldset button")]
      .find((b) => b.textContent?.startsWith("24"))
      ?.click();
    await warten();
    expect(punkte()).toBe(24);
  });

  it("lists only its own apps on the tab Apps", async () => {
    const { root } = await oeffne("/server/holm?tab=apps");
    const zeilen = [...root.querySelectorAll("main tbody tr")];
    expect(zeilen.length).toBeGreaterThan(0);
    expect(zeilen.every((z) => z.textContent?.includes("Schreinerei Holm"))).toBe(true);
  });
});

describe("the page of a customer", () => {
  it("heads with its apps in a sentence and its contract, and has two tabs", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    expect(root.querySelector("main h1")?.textContent).toBe("Atelier Nord");
    expect(root.textContent).toMatch(/\d+ Apps, (alle laufen|wird eingerichtet|davon)/);
    expect(root.textContent).toMatch(/· Vertrag seit \d\d\.\d\d\.\d{4}/);
    expect(reiter(root)).toEqual(["Überblick", "Verlauf"]);
    expect(root.querySelector('main [aria-haspopup="menu"]')?.textContent).toBe("Mehr …");
  });

  it("shows its apps, its contract and contact on Überblick", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    const apps = [...root.querySelectorAll("[data-testid=kunde-apps] li")];
    expect(apps.length).toBeGreaterThan(0);
    expect(apps[0]?.textContent).toContain("atelier-nord");
    expect(apps[0]?.querySelector("a")?.getAttribute("href")).toMatch(/^\/apps\//);
    expect(root.textContent).not.toContain("Dieser Monat");
    expect(root.textContent).toMatch(/Vertragsbeginn\d\d\.\d\d\.\d{4}/);
    expect(root.textContent).not.toContain("Stufe");
    expect(root.textContent).toContain("Ansprechperson");
  });

  it("has no tab Leistungen any more (Z-1201)", async () => {
    const { root } = await oeffne("/kunden/atelier-nord?tab=leistungen");
    expect(reiter(root)).not.toContain("Leistungen");
    expect(root.textContent).not.toContain("Was der Vertrag enthält");
  });

  it("has no tab Support any more (Z-1203)", async () => {
    const { root } = await oeffne("/kunden/atelier-nord?tab=support");
    expect(reiter(root)).not.toContain("Support");
    expect(knopf(root, "Zugang starten")).toBeUndefined();
  });
});

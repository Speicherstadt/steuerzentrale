import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import paket from "../../../../package.json" with { type: "json" };
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import type { Rolle } from "../daten/typen.ts";
import { brauchtAufmerksamkeit } from "../daten/zu-tun.ts";
import { demoBetrieb } from "../demo/betrieb-quelle.ts";
import { aufraeumen, oeffne, warten } from "../seiten/test-dom.tsx";

// docs/plan.md, "Navigation (Oberfläche 2026-11)": the sidebar with eight entries in two groups,
// the pages without an entry reached from their area, and the old addresses still working
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => setLocale("de", { reload: false }));
afterEach(() => {
  aufraeumen();
  rolle("inhaber");
});

const seitenleiste = (root: HTMLElement) => root.querySelector('nav[aria-label="Bereiche"]');

const gruppen = (root: HTMLElement) =>
  [...(seitenleiste(root)?.querySelectorAll(":scope > div") ?? [])].map((g) => [
    g.querySelector("h2")?.textContent,
    [...g.querySelectorAll("a")].map((a) => a.querySelector("span.truncate")?.textContent),
  ]);

const zahlVon = (root: HTMLElement, name: string) =>
  [...(seitenleiste(root)?.querySelectorAll("a") ?? [])]
    .find((a) => a.querySelector("span.truncate")?.textContent === name)
    ?.querySelector("span.tabular-nums")?.textContent;

const aktiv = (root: HTMLElement) =>
  [...(seitenleiste(root)?.querySelectorAll('a[aria-current="page"]') ?? [])].map(
    (a) => a.querySelector("span.truncate")?.textContent,
  );

const ueberschrift = (root: HTMLElement) => root.querySelector("main h1")?.textContent;

const reiter = (root: HTMLElement) =>
  [...root.querySelectorAll('main [aria-label="Teile des Protokolls"] [role="tab"]')].map((t) => [
    t.textContent,
    t.getAttribute("aria-selected"),
  ]);

describe("the sidebar", () => {
  it("has exactly eight entries in the groups Betrieb and Verwaltung", async () => {
    const { root } = await oeffne("/");
    expect(gruppen(root)).toEqual([
      ["Betrieb", ["Übersicht", "Apps", "Server", "Kunden", "Updates"]],
      ["Verwaltung", ["Katalog", "Protokoll", "Einstellungen"]],
    ]);
    expect(root.textContent).not.toContain("Sperrzeiten");
  });

  it('counts on Übersicht the rows of "Zu tun", as the overview does, and the updates', async () => {
    const eintraege = await demoBetrieb().uebersicht();
    if (!eintraege.ok) throw new Error("no overview in the demo");
    const n = brauchtAufmerksamkeit(eintraege.daten);
    expect(n).toBeGreaterThan(0);
    const { root } = await oeffne("/");
    expect(zahlVon(root, "Übersicht")).toBe(String(n));
    expect(root.textContent).toContain(`${n} Dinge brauchen dich`);
    expect(zahlVon(root, "Updates")).toBe("3");
    expect(zahlVon(root, "Apps")).toBeUndefined();
  });

  it("names the version of this build at its foot", async () => {
    const { root } = await oeffne("/");
    expect(root.textContent).toContain(`Version ${paket.version}`);
  });

  it.each([
    ["/apps/lind-haben", "Apps"],
    ["/backups", "Apps"],
    ["/support", "Kunden"],
    ["/katalog/haben", "Katalog"],
    ["/protokoll?tab=auftraege", "Protokoll"],
  ])("marks the area of %s", async (pfad, name) => {
    const { root } = await oeffne(pfad);
    expect(aktiv(root)).toEqual([name]);
  });
});

describe("pages without an entry", () => {
  it("are tabs of Kunden: Support-Zugänge, and no Leistungen (Z-1201)", async () => {
    const { root } = await oeffne("/support");
    const nav = root.querySelector('main nav[aria-label="Kunden und Support-Zugänge"]');
    const links = [...(nav?.querySelectorAll("a") ?? [])];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Kunden", "/kunden"],
      ["Support-Zugänge", "/support"],
    ]);
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe("Support-Zugänge");
    expect(ueberschrift(root)).toBe("Support-Zugänge");
  });

  it("reach the backups of every app from an app's tab Backups", async () => {
    const { root } = await oeffne("/apps/lind-haben?tab=backups");
    await warten();
    expect(root.querySelector('main a[href="/backups"]')?.textContent).toBe("Alle Backups");
    expect(root.querySelector('main nav[aria-label="Apps und Backups"]')).toBeNull();
  });
});

describe("the Protokoll", () => {
  it("has the tabs Ereignisse, Aufträge and Änderungen, the tab in the URL", async () => {
    const { root, router } = await oeffne("/protokoll");
    expect(ueberschrift(root)).toBe("Protokoll");
    expect(reiter(root)).toEqual([
      ["Ereignisse", "true"],
      ["Aufträge", "false"],
      ["Änderungen", "false"],
    ]);
    const auftraege = [...root.querySelectorAll<HTMLButtonElement>('main [role="tab"]')].find(
      (t) => t.textContent === "Aufträge",
    );
    auftraege?.click();
    await warten();
    expect(router.state.location.search).toEqual({ tab: "auftraege" });
    expect(reiter(root)[1]).toEqual(["Aufträge", "true"]);
  });

  it("opens the tab the URL names", async () => {
    const { root } = await oeffne("/protokoll?tab=aenderungen");
    expect(reiter(root)[2]).toEqual(["Änderungen", "true"]);
    // the audit log's entries, not the events of the first tab
    expect(root.querySelector('[aria-label="Einträge des Audit-Logs"]')).not.toBeNull();
  });

  it("shows Änderungen only to the roles that read the audit log", async () => {
    rolle("support");
    const { root } = await oeffne("/protokoll?tab=aenderungen");
    expect(reiter(root)).toEqual([
      ["Ereignisse", "true"],
      ["Aufträge", "false"],
    ]);
    expect(root.textContent).not.toContain("Änderungen");
  });
});

describe("the old addresses", () => {
  it.each([
    ["/installationen", "/apps", {}],
    ["/installationen/lind-haben", "/apps/lind-haben", {}],
    ["/ereignisse", "/protokoll", { tab: "ereignisse" }],
    ["/auftraege", "/protokoll", { tab: "auftraege" }],
    ["/audit", "/protokoll", { tab: "aenderungen" }],
  ])("%s lead to %s", async (alt, neu, suche) => {
    const { root, router } = await oeffne(alt);
    expect(router.state.location.pathname).toBe(neu);
    expect(router.state.location.search).toEqual(suche);
    expect(ueberschrift(root)).not.toBe("Nicht gefunden");
  });
});

import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { betriebsartQuelleEinsetzen } from "../daten/betriebsart.ts";
import { demoBetriebsart } from "../demo/betriebsart.ts";
import { mehrEintraege } from "./app-mehr.tsx";
import { aufraeumen, dialog, knopf, oeffne, reiterWaehlen, warten } from "./test-dom.tsx";

// docs/plan.md, "Navigation (Oberfläche 2026-11)": the page "Apps" as one table and the page of one
// app with its tabs, against the demo's sources, which answer as the Zentrale's API does
beforeEach(() => {
  setLocale("de", { reload: false });
  betriebsartQuelleEinsetzen(demoBetriebsart());
});
afterEach(aufraeumen);

const zeilen = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLTableRowElement>("main tbody tr")].filter((tr) =>
    tr.querySelector("a[href^='/apps/']"),
  );

/** The heads of the apps' table, not those of the observed services' below it (Z-1101) */
const spalten = (root: HTMLElement) => {
  const tabelle = [...root.querySelectorAll("main section")].find(
    (s) => s.getAttribute("aria-label") !== "Beobachtete Dienste" && s.querySelector("thead"),
  );
  return [...(tabelle?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent);
};

const schalter = async (root: HTMLElement, name: string) => {
  [...root.querySelectorAll<HTMLButtonElement>("main fieldset button")]
    .find((b) => b.textContent?.startsWith(name))
    ?.click();
  await warten();
};

describe("the page Apps", () => {
  it("lists every app in one table, what needs attention first, each row a link", async () => {
    const { root } = await oeffne("/apps");
    await warten();
    expect(spalten(root)).toEqual([
      "App",
      "Kunde",
      "Zustand",
      "Version",
      "Letztes Backup",
      "CPU",
      "RAM",
      "Server",
    ]);
    const z = zeilen(root);
    expect(z).toHaveLength(17);
    expect(z[0]?.querySelector("a")?.getAttribute("href")).toBe("/apps/berger-schreibzeug");
    expect(z[0]?.textContent).toContain("Störung: Health: HTTP 503");
    expect(z.at(-1)?.textContent).toContain("läuft");
    const sonne = z.find((tr) => tr.textContent?.includes("Café Sonne"));
    expect(sonne?.textContent).toContain("gekündigt zum 30.11.2026");
    expect(sonne?.querySelector('[aria-label="Version 0.12.0 ist verfügbar"]')).not.toBeNull();
    expect(z.find((tr) => tr.textContent?.includes("(intern)"))?.textContent).toContain("eigene");
  });

  it("filters to what needs someone and to what can be updated", async () => {
    const { root } = await oeffne("/apps");
    await schalter(root, "Braucht dich");
    expect(zeilen(root)).toHaveLength(5);
    await schalter(root, "Update möglich");
    const offen = zeilen(root);
    expect(offen.length).toBeGreaterThan(0);
    expect(offen.every((tr) => tr.querySelector('[aria-label$="ist verfügbar"]'))).toBe(true);
  });

  it("groups by customer or server under a head row each", async () => {
    const { root } = await oeffne("/apps");
    await schalter(root, "nach Server");
    const koepfe = [...root.querySelectorAll("main tbody tr.bg-muted")].map(
      (tr) => tr.querySelector("a")?.textContent,
    );
    expect(koepfe[0]).toBe("Gemeinsamer Server 2");
    expect(koepfe).toHaveLength(5);
    await schalter(root, "nach Kunde");
    expect(root.querySelector("main tbody tr.bg-muted a")?.textContent).toBe("IT Berger");
    expect(zeilen(root)).toHaveLength(17);
  });

  it('has no column Kunde in "Nur für mich"', async () => {
    betriebsartQuelleEinsetzen(
      demoBetriebsart({ betriebsart: "selbst", eigenerKundeId: "intern" }),
    );
    const { root } = await oeffne("/apps");
    expect(spalten(root)).toEqual([
      "App",
      "Zustand",
      "Version",
      "Letztes Backup",
      "CPU",
      "RAM",
      "Server",
    ]);
    expect(root.textContent).not.toContain("nach Kunde");
  });
});

describe("the page of an app", () => {
  it('heads with "App · Kunde", its state in a sentence, its address and the actions', async () => {
    const { root } = await oeffne("/apps/weber-haben");
    expect(root.querySelector("main h1")?.textContent).toBe("Haben · Praxis Weber");
    expect(root.textContent).toContain("Läuft, alles in Ordnung");
    expect(
      root.querySelector('main a[href="https://haben.praxis-weber.beispiel-hosting.de"]'),
    ).not.toBeNull();
    expect(knopf(root, "Neustart")).toBeDefined();
    expect(root.querySelector('main [aria-haspopup="menu"]')?.textContent).toBe("Mehr …");
  });

  it("shows five rows on Überblick, each from its source", async () => {
    const { root } = await oeffne("/apps/weber-haben");
    const text = (id: string) => root.querySelector(`[data-testid=${id}]`)?.textContent ?? "";
    expect(text("erreichbar")).toContain("Antwortet von außen in 48 ms");
    expect(text("erreichbar")).toContain("Zertifikat gültig bis");
    expect(text("version")).toContain("Version 0.12.0");
    expect(text("version")).toContain("Keine neuere Version freigegeben.");
    expect(text("backup")).toMatch(/Backup 03:15.*GB · jede Nacht · Prüf-Restore: /);
    expect(text("verfuegbarkeit-monate")).toBe(
      "VerfügbarkeitNovember 100 % · Oktober 100 %in Ordnung",
    );
    expect(text("server")).toContain("Server: Gemeinsamer Server 1");
    expect(text("server")).toContain("verbunden");
    expect(root.textContent).toMatch(/Vertragseit \d\d\.\d\d\.\d{4}/);
    expect(root.querySelector("[data-testid=zuletzt]")?.textContent).toContain("Einrichten");
  });

  it("opens the manual update from the row Version when one is offered", async () => {
    const { root } = await oeffne("/apps/sonne-haben");
    knopf(root, "Aktualisieren …")?.click();
    await warten();
    expect(dialog().textContent).toContain("0.12.0");
  });

  it("keeps the tab in the URL", async () => {
    const { root, router } = await oeffne("/apps/weber-haben");
    const tabs = [...root.querySelectorAll('main [role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual([
      "Überblick",
      "Messwerte",
      "Backups",
      "Einstellungen",
      "Verlauf",
      "Technik",
    ]);
    await reiterWaehlen(root, "Messwerte");
    expect(router.state.location.search).toEqual({ tab: "messwerte" });
    aufraeumen();
    const technik = (await oeffne("/apps/weber-haben?tab=technik")).root;
    expect(technik.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Technik",
    );
    expect(technik.textContent).toContain("sz-weber-haben");
  });

  it("shows on Messwerte a bar per day from the availability, and no series it has no data for", async () => {
    const { root } = await oeffne("/apps/berger-schreibzeug?tab=messwerte");
    await warten();
    const balken = [...root.querySelectorAll("[data-testid=tagesbalken] span")].map((b) =>
      b.getAttribute("data-ton"),
    );
    expect(balken).toHaveLength(90);
    // October and November measured, all well but the outage of this November, today; before none
    expect(balken.at(-1)).toBe("danger");
    expect(balken.at(-2)).toBe("ok");
    expect(balken[0]).toBe("leer");
    expect(root.querySelector("[data-testid=verfuegbarkeit-90]")?.textContent).toContain(
      "Tage mit Ausfall: 1",
    );
    const titel = [...root.querySelectorAll("main [role=tabpanel]:not([hidden]) h2")].map(
      (h) => h.textContent,
    );
    expect(titel).toEqual(["Verfügbarkeit · 90 Tage", "Daten", "CPU", "RAM"]);
    // Z-1106: CPU and memory of the app's user beside the size of its data
    expect(root.querySelectorAll("[data-testid=linie]")).toHaveLength(3);
    expect(root.querySelector("[data-testid=mess-ram]")?.textContent).toMatch(/MB/);
  });
});

describe("the menu Mehr", () => {
  const stand = {
    aktionen: { neustart: true, log_auszug: true, nur_lesen: false },
    recht: true,
    backup: true,
    pruef: true,
  };

  it("offers what the buttons offered, with the same rights", () => {
    expect(mehrEintraege(stand)).toEqual(["log", "backup", "pruef", "einstellungen"]);
    // a member takes a log excerpt and nothing else of "Mehr …" (Z-1204)
    expect(mehrEintraege({ ...stand, recht: false })).toEqual(["log"]);
    expect(mehrEintraege({ ...stand, backup: false })).toEqual(["log", "pruef", "einstellungen"]);
  });
});

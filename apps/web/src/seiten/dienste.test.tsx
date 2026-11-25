import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { betriebsartQuelleEinsetzen } from "../daten/betriebsart.ts";
import { diensteQuelleEinsetzen } from "../daten/dienste.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelle, serverQuelleEinsetzen } from "../daten/server.ts";
import { demoBetriebsart } from "../demo/betriebsart.ts";
import { demoDienste } from "../demo/dienste-quelle.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-1101: the observed services on the page "Apps", against the demo's source, which
// answers as the Zentrale's API does; marked "beobachtet", without version, backup or update
beforeEach(() => {
  setLocale("de", { reload: false });
  betriebsartQuelleEinsetzen(demoBetriebsart());
  diensteQuelleEinsetzen(demoDienste());
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: "inhaber" }));
});
afterEach(aufraeumen);

const tabelle = (root: HTMLElement) => {
  const t = root.querySelector<HTMLElement>('section[aria-label="Beobachtete Dienste"]');
  if (!t) throw new Error("no table of observed services");
  return t;
};
const koepfe = (t: HTMLElement) => [...t.querySelectorAll("th")].map((th) => th.textContent);
const zeilen = (t: HTMLElement) => [...t.querySelectorAll("tbody tr")].map((tr) => tr.textContent);

describe("observed services on the page Apps", () => {
  it("lists them marked as observed, the red one first, without version or backup", async () => {
    const { root } = await oeffne("/apps");
    const t = tabelle(root);
    expect(koepfe(t)).toEqual([
      "Dienst",
      "Kunde",
      "Zustand",
      "Verfügbarkeit im Monat",
      "Verwalten",
    ]);
    const z = zeilen(t);
    expect(z).toHaveLength(3);
    expect(z[0]).toContain("Statusseite Praxis Weber");
    expect(z[0]).toContain("beobachtet");
    expect(z[0]).toContain("status.praxis-weber.de/health");
    expect(z[0]).toContain("Praxis Weber");
    expect(z[0]).toContain("Zertifikat");
    expect(z[2]).toContain("Wiki");
    expect(z[2]).toContain("Erreichbar");
  });

  it("shows the units the agent reads and their state inside (Z-1103)", async () => {
    const { root } = await oeffne("/apps");
    const kontext = zeilen(tabelle(root)).find((z) => z?.includes("Kontext"));
    expect(kontext).toContain("kontext: kontext.service, kontext-redis.service");
    expect(kontext).toContain("innen: Units aktiv, Prüfung in Ordnung");
  });

  it("reads units only on an observed server, and refuses a name off the pattern", async () => {
    const { root } = await oeffne("/apps");
    knopf(root, "Dienst beobachten")?.click();
    await warten();
    eintragen("Name", "Grafana");
    eintragen("Adresse", "https://grafana.beispiel-hosting.de");
    const server = feld<HTMLSelectElement>("Server");
    expect([...server.options].map((o) => o.textContent)).toEqual([
      "Nur von außen prüfen",
      "Bestandsserver",
    ]);
    server.value = "bestand";
    server.dispatchEvent(new Event("change", { bubbles: true }));
    await warten();
    eintragen("Linux-Nutzer", "grafana");
    eintragen("systemd-Units", "grafana.service;reboot");
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(dialog().textContent).toContain("die Namen von Nutzer und Units stimmen nicht");
    eintragen("systemd-Units", "grafana.service, grafana-db.service");
    eintragen("Port auf 127.0.0.1", "3000");
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    const neu = zeilen(tabelle(root)).find((z) => z?.includes("Grafana"));
    expect(neu).toContain("grafana: grafana.service, grafana-db.service");
    expect(neu).toContain("innen: Noch keine Meldung");
  });

  it("keeps the units of a service when the servers cannot be listed", async () => {
    const vorher = serverQuelle();
    serverQuelleEinsetzen({
      ...vorher,
      liste: async () => ({ ok: false, status: 0, fehler: "netz" }),
    });
    try {
      const { root } = await oeffne("/apps");
      const zeile = [...tabelle(root).querySelectorAll("tbody tr")].find((tr) =>
        tr.textContent?.includes("Kontext"),
      );
      if (!zeile) throw new Error("no row Kontext");
      knopf(zeile, "Ändern")?.click();
      await warten();
      // no server to choose: the dialog must not take that for "only from outside"
      expect(dialog().querySelector('select[name="innenServer"]')).toBeNull();
      eintragen("Name", "Kontext neu");
      dialog().querySelector("form")?.requestSubmit();
      await warten();
      const neu = zeilen(tabelle(root)).find((z) => z?.includes("Kontext neu"));
      expect(neu).toContain("kontext: kontext.service, kontext-redis.service");
    } finally {
      serverQuelleEinsetzen(vorher);
    }
  });

  it("offers adding, changing and removing to the owner only", async () => {
    rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: "technik" }));
    const { root } = await oeffne("/apps");
    expect(knopf(root, "Dienst beobachten")).toBeUndefined();
    expect(koepfe(tabelle(root))).not.toContain("Verwalten");
  });

  it("adds a service, which is not checked yet", async () => {
    const { root } = await oeffne("/apps");
    knopf(root, "Dienst beobachten")?.click();
    await warten();
    eintragen("Name", "Nextcloud");
    eintragen("Adresse", "https://cloud.beispiel-hosting.de");
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    const neu = zeilen(tabelle(root)).find((z) => z?.includes("Nextcloud"));
    expect(neu).toContain("cloud.beispiel-hosting.de");
    expect(neu).toContain("Noch nicht geprüft");
  });

  it('has no column Kunde in "Nur für mich"', async () => {
    betriebsartQuelleEinsetzen(
      demoBetriebsart({ betriebsart: "selbst", eigenerKundeId: "intern" }),
    );
    const { root } = await oeffne("/apps");
    expect(koepfe(tabelle(root))).toEqual([
      "Dienst",
      "Zustand",
      "Verfügbarkeit im Monat",
      "Verwalten",
    ]);
  });
});

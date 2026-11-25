import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { betriebsartQuelleEinsetzen } from "../daten/betriebsart.ts";
import { diensteQuelleEinsetzen } from "../daten/dienste.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { demoBetriebsart } from "../demo/betriebsart.ts";
import { demoDienste } from "../demo/dienste-quelle.ts";
import { aufraeumen, dialog, eintragen, knopf, oeffne, warten } from "./test-dom.tsx";

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
    expect(z).toHaveLength(2);
    expect(z[0]).toContain("Statusseite Praxis Weber");
    expect(z[0]).toContain("beobachtet");
    expect(z[0]).toContain("status.praxis-weber.de/health");
    expect(z[0]).toContain("Praxis Weber");
    expect(z[0]).toContain("Zertifikat");
    expect(z[1]).toContain("Wiki");
    expect(z[1]).toContain("Erreichbar");
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

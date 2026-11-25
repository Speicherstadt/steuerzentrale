import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiApps, appsQuelleEinsetzen } from "../daten/apps.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demo } from "../demo/index.ts";
import { kunden } from "../demo/kunden.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { PROBE_MANIFEST } from "../demo/probe-manifest.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

/*
 * BAULISTE.md Z-501 in the interface, against the demo sources: the page Apps with the imported
 * versions, "Manifest fehlt" and the import of a signed manifest; the page Updates
 * with what each installation is offered; a customer marked as internal by the owner only.
 */

const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  appsQuelleEinsetzen(demoAppsQuelle(() => demo.jetzt));
  kundenQuelleEinsetzen(demoKunden(kunden, () => demo.jetzt));
  rolle("inhaber");
});
afterEach(() => {
  aufraeumen();
  vi.unstubAllGlobals();
});

const hochladen = async (label: string, text: string, name: string) => {
  const f = feld<HTMLInputElement>(label);
  const uebergabe = new DataTransfer();
  uebergabe.items.add(new File([text], name));
  f.files = uebergabe.files;
  f.dispatchEvent(new Event("change", { bubbles: true }));
  await warten();
};

const kachel = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll("main section")].find(
    (s) => s.querySelector("h2")?.textContent === name,
  );

/** The page Apps once its tiles are there: the demo's installations load on first use */
const appsSeite = async () => {
  const offen = await oeffne("/katalog");
  await vi.waitFor(() => {
    if (!kachel(offen.root, "Haben")) throw new Error("no tiles yet");
  });
  return offen;
};

/** An app's page once its versions are there */
const appSeite = async (id: string) => {
  const offen = await oeffne(`/katalog/${id}`);
  await vi.waitFor(() => {
    if (!offen.root.querySelector("[data-testid=app-version]")) throw new Error("no versions yet");
  });
  return offen;
};

const versionen = (root: HTMLElement) =>
  [...root.querySelectorAll("[data-testid=app-version]")].map((v) => v.textContent);

describe("the page Apps", () => {
  it("shows one tile per app with its version and only the hint that matters", async () => {
    const { root } = await appsSeite();
    const kontext = kachel(root, "Kontext");
    expect(kontext?.textContent).toContain("Version 0.1.37");
    expect(kontext?.textContent).toContain("0.1.40 erschienen – Manifest fehlt noch");
    expect(kontext?.querySelector("h2 a")?.getAttribute("href")).toBe("/katalog/kontext");
    expect(kachel(root, "Belegt")?.textContent).not.toContain("Manifest fehlt");
    // the facts stand on the app's page, not on its tile
    expect(kontext?.textContent).not.toContain("Health");
    expect(kontext?.querySelectorAll("li")).toHaveLength(0);
  });

  it("opens the dialog with the app chosen from its tile", async () => {
    const { root } = await appsSeite();
    const knopfDer = kachel(root, "Belegt")?.querySelector<HTMLButtonElement>(
      'button[aria-label="Belegt installieren"]',
    );
    knopfDer?.click();
    await warten();
    expect(feld<HTMLSelectElement>("App").value).toBe("belegt");
  });

  it("imports a signed manifest with a reason, and says when it was there already", async () => {
    const { root, router } = await appsSeite();
    knopf(root, "Manifest importieren")?.click();
    await warten();
    const neu = PROBE_MANIFEST.replace("version: 1.0.0", "version: 1.2.0\ndringend: true");
    await hochladen("Manifest (manifest.yml)", neu, "manifest.yml");
    await hochladen("Signatur (manifest.yml.minisig)", "sig", "manifest.yml.minisig");
    eintragen("Grund", "Release 1.2.0");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.querySelector("[role=status]")?.textContent).toBe("probe 1.2.0 ist importiert.");
    expect(kachel(root, "probe")?.textContent).toContain("Version 1.2.0");
    await router.navigate({ to: "/katalog/$app", params: { app: "probe" } });
    await warten();
    expect(versionen(root)[0]).toContain("1.2.0verfügbardringend");
  });

  it("refuses another text for an imported version in the dialog", async () => {
    const { root } = await appsSeite();
    knopf(root, "Manifest importieren")?.click();
    await warten();
    await hochladen("Manifest (manifest.yml)", `${PROBE_MANIFEST}hinweis: anders\n`, "m.yml");
    await hochladen("Signatur (manifest.yml.minisig)", "sig", "m.yml.minisig");
    eintragen("Grund", "anders");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(dialog().querySelector("[role=alert]")?.textContent).toContain(
      "schon mit anderem Inhalt importiert",
    );
  });

  it("offers import, the registry query and installing to the owner, not to a member", async () => {
    rolle("mitglied");
    const { root } = await appsSeite();
    expect(knopf(root, "Manifest importieren")).toBeUndefined();
    expect(knopf(root, "Nach neuen Versionen suchen")).toBeUndefined();
    expect(knopf(root, "Installieren")).toBeUndefined();
  });

  it("asks the Zentrale's registries on the button", async () => {
    const anfragen: string[] = [];
    vi.stubGlobal("fetch", async (pfad: string, init?: RequestInit) => {
      anfragen.push(`${init?.method ?? "GET"} ${pfad}`);
      return Response.json({ apps: [] });
    });
    appsQuelleEinsetzen(apiApps);
    const { root } = await appsSeite();
    knopf(root, "Nach neuen Versionen suchen")?.click();
    await warten();
    expect(anfragen).toContain("POST /api/v1/versionen/abfragen");
  });
});

describe("the page of an app", () => {
  it("shows the imported versions and a new one whose manifest is missing", async () => {
    const { root } = await appSeite("kontext");
    expect(versionen(root)[0]).toContain("0.1.40Manifest fehlt");
    expect(versionen(root)[1]).toContain("0.1.37verfügbar");
    const probe = await appSeite("probe");
    expect(versionen(probe.root)[0]).toContain("1.1.0-rc.1verfügbarVorabversion");
  });

  it("shows its sections with readable rows, and the actions it lacks with their issue", async () => {
    const { root } = await appSeite("haben");
    expect(root.querySelector("main h1")?.textContent).toBe("Haben");
    const titel = [...root.querySelectorAll("main section h2")].map((h) => h.textContent);
    expect(titel).toEqual([
      "Versionen",
      "Betrieb",
      "Sperrzeiten",
      "Aktionen",
      "Einstellungen",
      "Wo sie läuft",
    ]);
    const betrieb = root.querySelectorAll("main section")[1];
    expect([...(betrieb?.querySelectorAll("dt") ?? [])].map((d) => d.textContent)).toContain(
      "Arbeitsspeicher",
    );
    expect(root.textContent).toContain("Haben#945–#948");
    expect(root.querySelectorAll("[data-testid=app-ebene]")).toHaveLength(3);
    expect(root.querySelector('main a[href^="/apps/"]')).not.toBeNull();
  });

  it("is not found for an app neither described nor imported", async () => {
    const { root } = await oeffne("/katalog/gibt-es-nicht");
    await warten();
    expect(root.querySelector("main h1")?.textContent).toBe("Nicht gefunden");
  });
});

describe("the page Updates", () => {
  it("lists what each installation is offered", async () => {
    const { root } = await oeffne("/updates");
    const zeile = [...root.querySelectorAll("tbody tr")].find((tr) =>
      tr.querySelector('a[href$="/apps/atelier-belegt"]'),
    );
    expect(zeile?.textContent).toContain("0.0.6");
    expect(zeile?.textContent).toContain("0.0.7");
    expect(root.textContent).toContain("Haben 0.13.0 ist in der Registry erschienen");
  });
});

describe("an internal customer", () => {
  it("is marked by the owner with a reason", async () => {
    rolle("inhaber");
    const { root } = await oeffne("/kunden/atelier-nord");
    knopf(root, "Als intern markieren")?.click();
    await warten();
    expect(dialog().textContent).toContain("Atelier Nord als intern markieren");
    eintragen("Grund", "unsere Testinstallation");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.querySelector("main h1")?.parentElement?.textContent).toContain("intern");
    expect(knopf(root, "Nicht mehr intern")).toBeDefined();
  });

  it("is not marked by a member", async () => {
    rolle("mitglied");
    const { root } = await oeffne("/kunden/atelier-nord");
    expect(knopf(root, "Als intern markieren")).toBeUndefined();
  });
});

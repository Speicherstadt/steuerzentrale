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
 * versions, "neue Version, Manifest fehlt" and the import of a signed manifest; the page Updates
 * with what each installation is offered; a customer marked as internal by the owner only.
 */

const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  appsQuelleEinsetzen(demoAppsQuelle(() => demo.jetzt));
  kundenQuelleEinsetzen(demoKunden(kunden, () => demo.jetzt));
  rolle("technik");
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

const karte = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll("main section")].find(
    (s) => s.querySelector("h2")?.textContent === name,
  );

/** The page Apps once its cards are there: the demo's installations load on first use */
const appsSeite = async () => {
  const { root } = await oeffne("/apps");
  await vi.waitFor(() => {
    if (!karte(root, "Haben")) throw new Error("no cards yet");
  });
  return { root };
};

const versionen = (root: HTMLElement, name: string) =>
  [...(karte(root, name)?.querySelectorAll("[data-testid=app-version]") ?? [])].map(
    (v) => v.textContent,
  );

describe("the page Apps", () => {
  it("shows the imported versions and a new one whose manifest is missing", async () => {
    const { root } = await appsSeite();
    expect(versionen(root, "Kontext")[0]).toContain("0.1.40neue Version, Manifest fehlt");
    expect(versionen(root, "Kontext")[1]).toContain("0.1.37verfügbar");
    expect(karte(root, "Kontext")?.textContent).toContain("0.1.37 · 0.1.40 neu, Manifest fehlt");
    expect(versionen(root, "probe")[0]).toContain("1.1.0-rc.1verfügbarVorabversion");
  });

  it("imports a signed manifest with a reason, and says when it was there already", async () => {
    const { root } = await appsSeite();
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
    expect(versionen(root, "probe")[0]).toContain("1.2.0verfügbardringend");
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

  it("offers import and the registry query to owner and technik, not to support", async () => {
    rolle("support");
    const { root } = await appsSeite();
    expect(knopf(root, "Manifest importieren")).toBeUndefined();
    expect(knopf(root, "Registry abfragen")).toBeUndefined();
  });

  it("asks the Zentrale's registries on the button", async () => {
    const anfragen: string[] = [];
    vi.stubGlobal("fetch", async (pfad: string, init?: RequestInit) => {
      anfragen.push(`${init?.method ?? "GET"} ${pfad}`);
      return Response.json({ apps: [] });
    });
    appsQuelleEinsetzen(apiApps);
    const { root } = await appsSeite();
    knopf(root, "Registry abfragen")?.click();
    await warten();
    expect(anfragen).toContain("POST /api/v1/versionen/abfragen");
  });
});

describe("the page Updates", () => {
  it("lists what each installation is offered", async () => {
    const { root } = await oeffne("/updates");
    const zeile = [...root.querySelectorAll("tbody tr")].find((tr) =>
      tr.textContent?.startsWith("atelier-belegt"),
    );
    expect(zeile?.textContent).toContain("0.0.6");
    expect(zeile?.textContent).toContain("0.0.7");
    expect(root.textContent).toContain("Neu in der Registry");
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

  it("is not marked by technik", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    expect(knopf(root, "Als intern markieren")).toBeUndefined();
  });
});

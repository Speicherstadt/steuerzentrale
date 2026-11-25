import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dnsQuelleEinsetzen } from "../daten/dns.ts";
import { einstellungenQuelleEinsetzen } from "../daten/einstellungen.ts";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demoDns } from "../demo/dns.ts";
import { demoEinstellungenQuelle } from "../demo/einstellungen.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-404: the operator's values per app as a form from the schema, and "Einstellungen
// ändern" of an installation, only for the owner, against the demo sources
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  const kunden = demoKunden(demo.kunden, () => demo.jetzt);
  const server = demoServerQuelle(demo.server, () => demo.jetzt);
  kundenQuelleEinsetzen(kunden);
  serverQuelleEinsetzen(server);
  installationenQuelleEinsetzen(
    demoInstallationenQuelle({
      jetzt: () => demo.jetzt,
      kunden: kunden.liste,
      server: server.liste,
      manifest: demoAppsQuelle(() => demo.jetzt).manifest,
      betreiberWerte: [],
    }),
  );
  einstellungenQuelleEinsetzen(demoEinstellungenQuelle(demo));
  rolle("inhaber");
});
afterEach(aufraeumen);

const karte = (root: HTMLElement, titel: string) => {
  const k = [...root.querySelectorAll("section")].find(
    (s) => s.querySelector("h2")?.textContent === titel,
  );
  if (!k) throw new Error(`no card "${titel}"`);
  return k;
};

// The section "Werte für Apps" (the approved mockup "Einstellungen"): one card, an app at a time,
// each value under its title in words with the setting's name beside it
const WERTE = "Werte für Apps";
const ELSTER = "Hersteller-ID für ELSTER";
const SCHLUESSEL = "Schlüssel für die KI-Auslesung";

describe("the operator's values per app", () => {
  it("are a form from the schema, a secret only as set, saved with a reason", async () => {
    const { root } = await oeffne("/einstellungen");
    const werte = karte(root, WERTE);
    expect(werte.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Haben");
    expect(werte.textContent).toContain("Gilt für alle 9 Installationen von Haben");
    expect(werte.textContent).toContain("2 von 4 Werten gesetzt");
    expect(feld<HTMLInputElement>(ELSTER, werte).value).toBe("74931");
    expect(werte.textContent).toContain("ELSTER_HERSTELLER_ID");
    expect(werte.textContent).toContain("Pflicht");
    // a secret that is set: "gesetzt" and "Ändern", no field until then, and never its value
    expect(() => feld(SCHLUESSEL, werte)).toThrow();
    knopf(werte, "Ändern")?.click();
    await warten();
    const schluessel = feld<HTMLInputElement>(SCHLUESSEL, werte);
    expect(schluessel.type).toBe("password");
    expect(schluessel.value).toBe("");
    expect(werte.textContent).toContain("leer lassen behält den bisherigen");
    eintragen(ELSTER, "54321", werte);
    eintragen("Grund", "neue Hersteller-ID", werte);
    flush();
    werte.querySelector("form")?.requestSubmit();
    await warten();
    expect(root.textContent).toContain("Werte für Haben gespeichert.");
    expect(feld<HTMLInputElement>(ELSTER, karte(root, WERTE)).value).toBe("54321");
  });

  it("are refused without a required value, naming it", async () => {
    const { root } = await oeffne("/einstellungen");
    const werte = karte(root, WERTE);
    feld<HTMLInputElement>(ELSTER, werte).required = false;
    eintragen(ELSTER, "", werte);
    eintragen("Grund", "weg damit", werte);
    flush();
    werte.querySelector("form")?.requestSubmit();
    await warten();
    expect(werte.querySelector("form [role=alert]")?.textContent).toContain("ELSTER_HERSTELLER_ID");
  });

  it("are only read by a member", async () => {
    rolle("mitglied");
    const { root } = await oeffne("/einstellungen");
    const werte = karte(root, WERTE);
    expect(werte.querySelector("form")).toBeNull();
    expect(werte.textContent).toContain(ELSTER);
    expect(werte.textContent).toContain("74931");
  });
});

// The sections in a list on the left, the chosen one in the URL and marked as the current page
describe("the sections of the settings", () => {
  const abschnitte = (root: HTMLElement) =>
    root.querySelector('nav[aria-label="Abschnitte der Einstellungen"]');

  it("list every section with a line on it, and open the one the URL names", async () => {
    const { root } = await oeffne("/einstellungen?tab=dns");
    const nav = abschnitte(root);
    expect(
      [...(nav?.querySelectorAll("a") ?? [])].map((a) => a.querySelector("span")?.textContent),
    ).toEqual([
      "Betriebsart",
      "Werte für Apps",
      "Backup-Ziel",
      "Adressen und DNS",
      "Benachrichtigungen",
      "Konten",
      "Steuerzentrale",
      "Darstellung",
    ]);
    expect(nav?.textContent).toContain("Domain und Cloudflare");
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toContain("Adressen und DNS");
    expect(karte(root, "DNS")).toBeDefined();
  });

  it('mark "Werte für Apps" also when the URL names it', async () => {
    const { root } = await oeffne("/einstellungen?tab=werte");
    expect(abschnitte(root)?.querySelector('[aria-current="page"]')?.textContent).toContain(
      "Werte für Apps",
    );
  });

  it("go to another section through its link, with the section in the URL", async () => {
    const { root, router } = await oeffne("/einstellungen");
    expect(abschnitte(root)?.querySelector('[aria-current="page"]')?.textContent).toContain(
      "Werte für Apps",
    );
    const backup = [...(abschnitte(root)?.querySelectorAll("a") ?? [])].find((a) =>
      a.textContent?.includes("Backup-Ziel"),
    );
    backup?.click();
    await warten();
    expect(router.state.location.search).toEqual({ tab: "backup" });
    const markiert = abschnitte(root)?.querySelectorAll('[aria-current="page"]') ?? [];
    expect([...markiert].map((a) => a.querySelector("span")?.textContent)).toEqual(["Backup-Ziel"]);
    expect(karte(root, "Backup")).toBeDefined();
    expect(() => karte(root, WERTE)).toThrow();
  });
});

// Z-407: domain, zone and Cloudflare token; the token never comes back, only as set
describe("the DNS settings", () => {
  const dnsKarte = async (rolleName: Rolle = "inhaber") => {
    rolle(rolleName);
    const { root } = await oeffne("/einstellungen?tab=dns");
    return { root, k: karte(root, "DNS") };
  };

  it("are saved with a reason; the token shows only as set and its field stays empty", async () => {
    dnsQuelleEinsetzen(demoDns({ domain: null, zoneId: null, tokenGesetzt: false }));
    const { root, k } = await dnsKarte();
    expect(feld<HTMLInputElement>("API-Token", k).required).toBe(true);
    eintragen("Domain", "apps.example.de", k);
    eintragen("Zone-ID", "023e105f4ecef8ad9ca31a8372d0c353", k);
    eintragen("API-Token", "cf-token-aus-dem-dashboard-1234567890", k);
    eintragen("Grund", "Zone angelegt", k);
    flush();
    k.querySelector("form")?.requestSubmit();
    await warten();
    const neu = karte(root, "DNS");
    expect(neu.textContent).toContain("DNS-Einstellungen gespeichert.");
    expect(feld<HTMLInputElement>("Domain", neu).value).toBe("apps.example.de");
    expect(feld<HTMLInputElement>("API-Token", neu).value).toBe("");
    expect(feld<HTMLInputElement>("API-Token", neu).required).toBe(false);
    expect(neu.textContent).toContain("gesetzt; leer lassen behält den Token");
    expect(root.textContent).not.toContain("cf-token-aus-dem-dashboard");
  });

  it("are only read by a member", async () => {
    dnsQuelleEinsetzen(demoDns());
    const { k } = await dnsKarte("mitglied");
    expect(k.querySelector("form")).toBeNull();
    expect(k.textContent).toContain("apps.beispiel-hosting.de");
    expect(k.textContent).toContain("<app>.<kürzel>.apps.beispiel-hosting.de");
    expect(k.textContent).toContain("gesetzt");
  });
});

describe("changing an installation's settings", () => {
  it("sends the job to configure it anew with a reason", async () => {
    const { root } = await oeffne("/apps/atelier-schreibzeug");
    knopf(root, "Einstellungen ändern")?.click();
    await warten();
    expect(feld<HTMLInputElement>("SCHREIBZEUG_OPEN_SIGNUP").value).toBe("false");
    eintragen("SCHREIBZEUG_OPEN_SIGNUP", "true");
    eintragen("Grund", "Wunsch des Kunden");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("Neu konfigurieren");
  });

  it("is not offered to a member", async () => {
    rolle("mitglied");
    const { root } = await oeffne("/apps/atelier-haben");
    expect(knopf(root, "Einstellungen ändern")).toBeUndefined();
  });
});

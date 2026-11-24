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
// ändern" of an installation, only for owner and technik, against the demo sources
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
  rolle("technik");
});
afterEach(aufraeumen);

const karte = (root: HTMLElement, titel: string) => {
  const k = [...root.querySelectorAll("section")].find(
    (s) => s.querySelector("h2")?.textContent === titel,
  );
  if (!k) throw new Error(`no card "${titel}"`);
  return k;
};

describe("the operator's values per app", () => {
  it("are a form from the schema, a secret only as set, saved with a reason", async () => {
    const { root } = await oeffne("/einstellungen");
    const haben = karte(root, "Haben");
    expect(feld<HTMLInputElement>("ELSTER_HERSTELLER_ID", haben).value).toBe("74931");
    const schluessel = feld<HTMLInputElement>("ANTHROPIC_API_KEY", haben);
    expect(schluessel.type).toBe("password");
    expect(schluessel.value).toBe("");
    expect(haben.textContent).toContain("gesetzt; leer lassen behält den Wert");
    eintragen("ELSTER_HERSTELLER_ID", "54321", haben);
    eintragen("Grund", "neue Hersteller-ID", haben);
    flush();
    haben.querySelector("form")?.requestSubmit();
    await warten();
    expect(root.textContent).toContain("Werte für Haben gespeichert.");
    expect(feld<HTMLInputElement>("ELSTER_HERSTELLER_ID", karte(root, "Haben")).value).toBe(
      "54321",
    );
  });

  it("are refused without a required value, naming it", async () => {
    const { root } = await oeffne("/einstellungen");
    const haben = karte(root, "Haben");
    feld<HTMLInputElement>("ELSTER_HERSTELLER_ID", haben).required = false;
    eintragen("ELSTER_HERSTELLER_ID", "", haben);
    eintragen("Grund", "weg damit", haben);
    flush();
    haben.querySelector("form")?.requestSubmit();
    await warten();
    expect(haben.querySelector("[role=alert]")?.textContent).toContain("ELSTER_HERSTELLER_ID");
  });

  it("are only read by support", async () => {
    rolle("support");
    const { root } = await oeffne("/einstellungen");
    const haben = karte(root, "Haben");
    expect(haben.querySelector("form")).toBeNull();
    expect(haben.textContent).toContain("74931");
  });
});

// Z-407: domain, zone and Cloudflare token; the token never comes back, only as set
describe("the DNS settings", () => {
  const dnsKarte = async (rolleName: Rolle = "technik") => {
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

  it("are only read by support", async () => {
    dnsQuelleEinsetzen(demoDns());
    const { k } = await dnsKarte("support");
    expect(k.querySelector("form")).toBeNull();
    expect(k.textContent).toContain("apps.beispiel-hosting.de");
    expect(k.textContent).toContain("<app>.<kürzel>.apps.beispiel-hosting.de");
    expect(k.textContent).toContain("gesetzt");
  });
});

describe("changing an installation's settings", () => {
  it("sends the job to configure it anew with a reason", async () => {
    const { root } = await oeffne("/installationen/atelier-schreibzeug");
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

  it("is not offered to support", async () => {
    rolle("support");
    const { root } = await oeffne("/installationen/atelier-haben");
    expect(knopf(root, "Einstellungen ändern")).toBeUndefined();
  });
});

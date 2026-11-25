import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsQuelleEinsetzen } from "../daten/apps.ts";
import { dnsQuelleEinsetzen } from "../daten/dns.ts";
import { apiInstallationen, installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demoDns } from "../demo/dns.ts";
import { demo } from "../demo/index.ts";
import { GESCHEITERT } from "../demo/installationen-bestand.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-402: the dialog "Installieren" with the placement live, making an installation
// that waits for its agent, and removing a failed one, against the demo sources; since Z-501 from
// an imported manifest, chosen by app and version
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  const kunden = demoKunden(demo.kunden, () => demo.jetzt);
  const server = demoServerQuelle(demo.server, () => demo.jetzt);
  const apps = demoAppsQuelle(() => demo.jetzt);
  kundenQuelleEinsetzen(kunden);
  serverQuelleEinsetzen(server);
  appsQuelleEinsetzen(apps);
  installationenQuelleEinsetzen(
    demoInstallationenQuelle({
      jetzt: () => demo.jetzt,
      kunden: kunden.liste,
      server: server.liste,
      manifest: apps.manifest,
      betreiberWerte: [],
    }),
  );
  rolle("inhaber");
  dnsQuelleEinsetzen(demoDns());
});
afterEach(aufraeumen);

const waehlen = async (label: string, wert: string) => {
  const s = feld<HTMLSelectElement>(label);
  s.value = wert;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  await warten();
};

/** The versions the dialog offers for the chosen app */
const versionen = () =>
  [...feld<HTMLSelectElement>("Version").options].map((o) => o.value).filter(Boolean);

/** Opens the dialog and chooses customer, server and the imported probe app in `version` */
const auswaehlen = async (root: HTMLElement, kunde: string, server: string, version = "1.0.0") => {
  knopf(root, "App installieren")?.click();
  await warten();
  await waehlen("Kunde", kunde);
  await waehlen("Server", server);
  await waehlen("App", "probe");
  await waehlen("Version", version);
};

const platzierung = () => dialog().querySelector("[data-testid=platzierung]")?.textContent ?? "";

describe("the dialog Installieren", () => {
  it("shows the placement, the manifest's settings and makes an installation", async () => {
    const { root } = await oeffne("/apps");
    await auswaehlen(root, "atelier-nord", "shared-1");
    expect(dialog().textContent).not.toContain("Manifest (manifest.yml)");
    expect(dialog().textContent).toContain("Manifest probe 1.0.0");
    expect(platzierung()).toContain("Passt");
    expect(platzierung()).toContain("probe auf Gemeinsamer Server 1");
    expect(feld<HTMLInputElement>("PROBE_KENNWORT").type).toBe("password");
    expect(feld<HTMLInputElement>("PROBE_KENNWORT").required).toBe(true);
    expect(feld<HTMLInputElement>("PROBE_LIMIT").type).toBe("number");
    eintragen("PROBE_KENNWORT", "geheim-7");
    eintragen("Adresse", "probe.atelier-nord.example");
    eintragen("Grund", "Bestellung vom 20.11.");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    // the new app stands with its customer, on its way, among those not needing anyone
    const zeile = [...root.querySelectorAll("tbody tr")].find(
      (tr) => tr.textContent?.includes("probe") && tr.textContent?.includes("Atelier Nord"),
    );
    expect(zeile?.textContent).toContain("wird eingerichtet");
  });

  it("asks again when an option changes, with the option's setting", async () => {
    const { root } = await oeffne("/apps");
    await auswaehlen(root, "atelier-nord", "shared-1");
    expect(() => feld("PROBE_EXTRA")).toThrow();
    const option = [...dialog().querySelectorAll("label")].find(
      (l) => l.textContent?.trim() === "Zusatzdienst",
    );
    option?.querySelector("input")?.click();
    await warten();
    expect(feld<HTMLInputElement>("PROBE_EXTRA").required).toBe(false);
    expect(platzierung()).toContain("Passt");
  });

  it("names every reason when the app does not fit, and keeps the dialog open", async () => {
    const { root } = await oeffne("/apps");
    // Z-1205: a server belongs to no customer; the silent agent of "kraft" is the reason here
    await auswaehlen(root, "atelier-nord", "kraft");
    expect(platzierung()).toContain("Passt nicht");
    expect(platzierung()).toContain("Der Agent des Servers ist nicht verbunden.");
    eintragen("PROBE_KENNWORT", "geheim-7");
    eintragen("Adresse", "probe.atelier-nord.example");
    eintragen("Grund", "Test");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(dialog().querySelector("[role=alert]")?.textContent).toBe(
      "Die App passt nicht auf diesen Server.",
    );
    expect(dialog().textContent).toContain("Der Agent des Servers ist nicht verbunden.");
  });

  // Z-501: a pre-release only for an internal customer
  it("offers a pre-release only to an internal customer", async () => {
    const { root } = await oeffne("/apps");
    await auswaehlen(root, "atelier-nord", "shared-1");
    expect(versionen()).toEqual(["1.0.0"]);
    await waehlen("Kunde", "intern");
    expect(versionen()).toEqual(["1.1.0-rc.1", "1.0.0"]);
    await waehlen("Version", "1.1.0-rc.1");
    expect(feld<HTMLSelectElement>("Version").selectedOptions[0]?.textContent).toBe(
      "1.1.0-rc.1 · Vorabversion",
    );
    expect(platzierung()).toContain("Passt");
  });

  it("reads its form from the app's real manifest (manifeste/haben/0.12.0)", async () => {
    const { root } = await oeffne("/apps");
    await auswaehlen(root, "atelier-nord", "shared-1");
    await waehlen("App", "haben");
    await waehlen("Version", "0.12.0");
    expect(dialog().querySelector("[data-testid=manifest-befund]")?.textContent).not.toContain(
      "kein_manifest",
    );
    expect(dialog().textContent).toContain("OIDC_ONLY");
  });

  it("starts from the customer's page with the customer chosen", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    knopf(root, "App installieren")?.click();
    await warten();
    expect(feld<HTMLSelectElement>("Kunde").value).toBe("atelier-nord");
  });

  it("is not offered to a member", async () => {
    rolle("mitglied");
    const { root } = await oeffne("/apps");
    expect(root.querySelector("main h1")?.textContent).toBe("Apps");
    expect(knopf(root, "App installieren")).toBeUndefined();
  });
});

describe("a failed setup", () => {
  it("is removed with a reason, and the removal job shows", async () => {
    const { root } = await oeffne(`/apps/${GESCHEITERT}?tab=technik`);
    expect(root.textContent).toContain("Einrichtung gescheitert");
    expect(root.textContent).toContain("Fehler: image ziehen");
    knopf(root, "Entfernen …")?.click();
    await warten();
    eintragen("Grund", "neu anlegen");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("an den Agenten zugestellt");
  });

  it("offers no removal to a member", async () => {
    rolle("mitglied");
    const { root } = await oeffne(`/apps/${GESCHEITERT}`);
    expect(root.textContent).toContain("Einrichtung gescheitert");
    expect(knopf(root, "Entfernen …")).toBeUndefined();
  });
});

describe("with the Zentrale's API", () => {
  const probe = {
    installationId: "probe-abc123",
    kundeId: "atelier-nord",
    serverId: "shared-1",
    app: "probe",
    version: "1.0.0",
    manifestHash: "0".repeat(64),
    host: "probe.atelier-nord.example",
    httpPort: 20001,
    ports: { "app:9000": 20002 },
    optionen: [],
    einstellungen: { betreiber: {}, installation: { PROBE_TITEL: "Atelier" } },
    zustand: "wird_eingerichtet",
    health: {
      zustand: "unbekannt",
      grund: { code: "noch_keine_meldung", werte: {} },
      seit: null,
      gemeldetAm: null,
      units: [],
    },
    angelegtVon: "u1",
    angelegtAm: demo.jetzt,
    geaendertAm: demo.jetzt,
  };
  /** The same once it runs and its agent reports a failed unit and a red check (Z-403) */
  const rot = {
    ...probe,
    zustand: "laeuft",
    health: {
      zustand: "rot",
      grund: { code: "health", werte: { text: "HTTP 503" } },
      seit: Date.now() - 6 * 60_000,
      gemeldetAm: Date.now() - 12_000,
      units: [{ name: "probe-app.service", aktiv: "failed" }],
    },
  };
  const verlauf = [
    {
      zeitpunkt: Date.now() - 6 * 60_000,
      bewertung: "rot",
      grund: { code: "health", werte: { text: "HTTP 503" } },
    },
    {
      zeitpunkt: Date.now() - 7 * 60_000,
      bewertung: "gelb",
      grund: { code: "unit", werte: { unit: "probe-app.service", aktiv: "failed" } },
    },
  ];
  const antworten = (i: Record<string, unknown>) =>
    vi.stubGlobal("fetch", async (pfad: string) =>
      pfad.endsWith("/installationen")
        ? Response.json({ installationen: [i] })
        : Response.json({
            ...i,
            auftraege,
            verlauf: i === probe ? [] : verlauf,
            aktionen: { neustart: true, log_auszug: true, nur_lesen: false },
          }),
    );
  const auftraege = [
    {
      auftragId: "a1",
      aktion: "installation_einrichten",
      zustand: "bestaetigt",
      fortschritt: "image ziehen",
      fehler: null,
      angelegtAm: demo.jetzt,
      geaendertAm: demo.jetzt,
    },
  ];

  beforeEach(() => {
    installationenQuelleEinsetzen(apiInstallationen);
    antworten(probe);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists what the Zentrale answers, without inventing health or backups", async () => {
    const { root } = await oeffne("/apps");
    const zeilen = [...root.querySelectorAll("tbody tr")].filter((tr) =>
      tr.querySelector("a[href^='/apps/']"),
    );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.textContent).toContain("Atelier Nord");
    expect(zeilen[0]?.textContent).toContain("wird eingerichtet");
    expect(zeilen[0]?.textContent).toContain("–");
  });

  it("shows an installation with its place, values and jobs (tab Technik)", async () => {
    const { root } = await oeffne("/apps/probe-abc123?tab=technik");
    expect(root.querySelector("main h1")?.textContent).toBe("probe · Atelier Nord");
    expect(root.textContent).toContain("sz-probe-abc123");
    expect(root.textContent).toContain("127.0.0.1:20001");
    expect(root.textContent).toContain("app:9000 → 20002");
    expect(root.textContent).toContain("Einrichten");
    expect(root.textContent).toContain("vom Agenten bestätigt");
    expect(root.textContent).toContain("image ziehen");
  });

  it("shows no state before the agent reported, and no history", async () => {
    const { root } = await oeffne("/apps/probe-abc123?tab=technik");
    expect(root.querySelector("[data-testid=health]")?.textContent).toContain(
      "Noch keine Meldung des Agenten",
    );
    aufraeumen();
    const verlauf = await oeffne("/apps/probe-abc123?tab=verlauf");
    expect(verlauf.root.textContent).toContain("Noch kein Wechsel.");
  });

  it("lists a running installation with its state and reason (Z-403)", async () => {
    antworten(rot);
    const { root } = await oeffne("/apps");
    const zeile = [...root.querySelectorAll("tbody tr")].find((tr) =>
      tr.querySelector("a[href^='/apps/']"),
    );
    expect(zeile?.textContent).toContain("Störung: Health: HTTP 503");
  });

  it("shows the state with reason, since, units and the history (Z-403)", async () => {
    antworten(rot);
    const { root } = await oeffne("/apps/probe-abc123?tab=technik");
    const health = root.querySelector("[data-testid=health]")?.textContent ?? "";
    expect(health).toContain("Health: HTTP 503 · seit");
    expect(health).toContain("Rot");
    expect(root.textContent).toMatch(/zuletzt gemeldet vor \d+ s/);
    expect(root.textContent).toContain("probe-app.service");
    expect(root.textContent).toContain("systemd: failed");
    aufraeumen();
    const verlauf = (await oeffne("/apps/probe-abc123?tab=verlauf")).root;
    const eintraege = [...verlauf.querySelectorAll("[data-testid=verlauf] li")].map(
      (li) => li.textContent,
    );
    expect(eintraege).toHaveLength(2);
    expect(eintraege[0]).toContain("Rot");
    expect(eintraege[1]).toContain("Gelb");
    expect(eintraege[1]).toContain("Unit probe-app.service: failed");
  });

  it("shows the Zentrale's refusal", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ fehler: "keine_berechtigung" }, { status: 403 }),
    );
    const { root } = await oeffne("/apps/probe-abc123");
    expect(root.querySelector("main [role=alert]")?.textContent).toBe(
      "Dafür fehlt Ihrer Rolle das Recht.",
    );
  });
});

describe("the suggested address (Z-407)", () => {
  // Z-407: the address `<app>.<kuerzel>.<domain>`, the domain from the DNS settings
  it("suggests the address from app, short name and domain, and keeps what is typed", async () => {
    dnsQuelleEinsetzen(demoDns({ domain: "apps.example.de", zoneId: null, tokenGesetzt: false }));
    const { root } = await oeffne("/apps");
    await auswaehlen(root, "atelier-nord", "shared-1");
    expect(feld<HTMLInputElement>("Adresse").value).toBe("probe.atelier-nord.apps.example.de");
    expect(dialog().textContent).toContain("Unter apps.example.de setzt die Zentrale A und AAAA");
    eintragen("Adresse", "probe.eigene-domain.example");
    await warten();
    expect(feld<HTMLInputElement>("Adresse").value).toBe("probe.eigene-domain.example");
    await waehlen("Kunde", "praxis-weber");
    expect(feld<HTMLInputElement>("Adresse").value).toBe("probe.praxis-weber.apps.example.de");
  });

  it("suggests no address while the operator has no domain", async () => {
    dnsQuelleEinsetzen(demoDns({ domain: null, zoneId: null, tokenGesetzt: false }));
    const { root } = await oeffne("/apps");
    await auswaehlen(root, "atelier-nord", "shared-1");
    expect(feld<HTMLInputElement>("Adresse").value).toBe("");
    expect(dialog().textContent).toContain("Ohne Domain in den DNS-Einstellungen");
  });
});

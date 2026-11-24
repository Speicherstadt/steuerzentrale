import { render } from "@solidjs/web";
import { setLocale } from "@steuerzentrale/ui";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/solid-router";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ServerDerZentrale, serverQuelle, serverQuelleEinsetzen } from "./daten/server.ts";
import { routeTree } from "./routeTree.gen.ts";

// The pages in the router, rendered from the demo fixtures: heading, path and content
let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});
beforeEach(() => {
  setLocale("de", { reload: false });
  // The pages of the sign-in ask the Zentrale; here no one is signed in
  vi.stubGlobal("fetch", async () =>
    Response.json({ fehler: "nicht_angemeldet" }, { status: 401 }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const oeffne = async (pfad: string) => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pfad] }),
  });
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <RouterProvider router={router} />, root);
  await router.load();
  await new Promise((fertig) => setTimeout(fertig, 0));
  // a page that loads its data first (the demo installations load on first use) has its heading
  // only then; the assertions below say what is missing if it never comes
  await vi
    .waitFor(() => {
      if (!root.querySelector("main h1")) throw new Error("no heading yet");
    })
    .catch(() => undefined);
  return root;
};

const ueberschrift = (root: HTMLElement) => root.querySelector("main h1")?.textContent;

// Every route once on Solid's dev build: a 1.x-style read or write fails here (vitest.solid-diagnostics.ts)
const ALLE = [
  ["/", "Übersicht"],
  ["/server", "Server"],
  ["/server/holm", "Schreinerei Holm"],
  ["/installationen", "Installationen"],
  ["/installationen/kraft-stellwerk", "Ingenieurbüro Kraft · Stellwerk"],
  ["/updates", "Updates"],
  ["/backups", "Backups"],
  ["/auftraege", "Aufträge"],
  ["/kunden", "Kunden"],
  ["/kunden/sonne", "Café Sonne"],
  ["/support", "Support-Zugänge"],
  ["/leistungen", "Leistungen"],
  ["/apps", "Apps"],
  ["/ereignisse", "Ereignisse"],
  ["/audit", "Audit-Log"],
  ["/einstellungen", "Einstellungen"],
  ["/anmelden", "Anmelden"],
  ["/einrichtung", "Zweiter Faktor"],
  ["/einladung", "Einladung"],
  ["/erster-inhaber", "Zentrale einrichten"],
] as const;

describe("every page", () => {
  it.each(ALLE)("%s renders its heading", async (pfad, titel) => {
    expect(ueberschrift(await oeffne(pfad))).toBe(titel);
  });

  it("of the sign-in stands outside the shell, a page of the shell inside it", async () => {
    expect((await oeffne("/anmelden")).querySelector("aside")).toBeNull();
    dispose();
    expect((await oeffne("/server")).querySelector("aside")).not.toBeNull();
  });

  it("of the setup says when no one is signed in", async () => {
    const root = await oeffne("/einrichtung");
    await new Promise((fertig) => setTimeout(fertig, 0));
    expect(root.textContent).toContain("Nicht angemeldet");
  });
});

describe("pages", () => {
  it("open the overview with what needs attention, worst first", async () => {
    const root = await oeffne("/");
    expect(ueberschrift(root)).toBe("Übersicht");
    // the open fault first, leading to its installation (Z-406: as GET /api/v1/uebersicht orders)
    const erster = root.querySelector<HTMLAnchorElement>("main ul li a");
    expect(erster?.textContent).toContain("IT Berger · Schreibzeug");
    expect(erster?.querySelector("svg")?.getAttribute("aria-label")).toBe("Störung");
    expect(erster?.getAttribute("href")).toBe("/installationen/berger-schreibzeug");
    const rang = { Störung: 0, Warnung: 1, Hinweis: 2 } as Record<string, number>;
    const schweren = [
      ...root.querySelectorAll("main ul.divide-y > li > a > span:first-child svg"),
    ].map((s) => rang[s.getAttribute("aria-label") ?? ""] ?? 9);
    expect(schweren.length).toBeGreaterThan(3);
    expect(schweren).toEqual([...schweren].sort((a, b) => a - b));
  });

  // Z-702: a check red over 90 % disk is a fault, leading to its server
  it("name a server's check on the overview, leading to the server", async () => {
    const root = await oeffne("/");
    const eintrag = [...root.querySelectorAll<HTMLAnchorElement>("main ul li a")].find((a) =>
      a.textContent?.includes("Platte: 91 % belegt (Grenze 90 %)"),
    );
    expect(eintrag?.textContent).toContain("Studio Lind");
    expect(eintrag?.querySelector("svg")?.getAttribute("aria-label")).toBe("Störung");
    expect(eintrag?.getAttribute("href")).toBe("/server/lind");
  });

  it("show the apps with a released manifest on the apps page, and an app only imported (Z-501)", async () => {
    const root = await oeffne("/apps");
    const namen = [...root.querySelectorAll("main section h2")].map((h) => h.textContent);
    expect(namen).toEqual([
      "Haben",
      "Belegt",
      "Kontext",
      "Schreibzeug",
      "Stellwerk",
      "Kennwort",
      "probe",
    ]);
    expect(root.textContent).toContain("Haben#945–#948");
  });

  it("name the object of a detail page in the path", async () => {
    const root = await oeffne("/server/shared-2");
    expect(ueberschrift(root)).toBe("Gemeinsamer Server 2");
    const pfad = root.querySelector('nav[aria-label="Pfad"]');
    expect(pfad?.textContent).toContain("Server");
    expect(pfad?.querySelector('[aria-current="page"]')?.textContent).toBe("Gemeinsamer Server 2");
  });

  it("mark the current area in the sidebar, also on a detail page", async () => {
    const root = await oeffne("/installationen/lind-haben");
    const aktiv = root.querySelector('nav[aria-label="Bereiche"] a[aria-current="page"]');
    expect(aktiv?.textContent).toContain("Installationen");
    expect(ueberschrift(root)).toBe("Studio Lind · Haben");
  });

  it("claim no check as OK on a server whose agent is silent", async () => {
    // kraft: agent silent for 6 minutes, the checks run every 5; as on the installation page,
    // the last known values are no fresh check (no green without a check)
    const root = await oeffne("/server/kraft");
    const karte = [...root.querySelectorAll("main section")].find(
      (s) => s.querySelector("h2")?.textContent === "Prüfungen",
    );
    expect(karte).toBeDefined();
    const zustaende = [...(karte?.querySelectorAll("span.inline-flex") ?? [])].map(
      (z) => z.textContent,
    );
    expect(zustaende).not.toContain("OK");
    expect(karte?.textContent).toContain("Agent still: letzter bekannter Stand");
  });

  it("bill no month before a customer's contract began", async () => {
    // Ingenieurbüro Kraft is a customer since 06.11.2026: October has no availability or data of it
    const root = await oeffne("/leistungen");
    const wahl = root.querySelector<HTMLSelectElement>("[data-testid=leistungen-monat]");
    if (!wahl) throw new Error("no month to choose");
    wahl.value = "2026-10";
    wahl.dispatchEvent(new Event("change", { bubbles: true }));
    flush();
    await vi.waitFor(() => {
      if (!root.querySelector('section[aria-label="Leistungen Oktober 2026"]'))
        throw new Error("not yet October");
    });
    const tabelle = root.querySelector('section[aria-label="Leistungen Oktober 2026"]');
    expect(tabelle?.textContent).toContain("Fotografie Aust");
    expect(tabelle?.textContent).not.toContain("Ingenieurbüro Kraft");
    expect(root.querySelector("a[download]")?.getAttribute("download")).toBe(
      "leistungen-2026-10.csv",
    );
  });

  it("download the month as CSV with the same sums as the table", async () => {
    const root = await oeffne("/leistungen");
    const href = root.querySelector("a[download]")?.getAttribute("href") ?? "";
    expect(href.startsWith("data:text/csv;charset=utf-8,")).toBe(true);
    const csv = decodeURIComponent(href.slice(href.indexOf(",") + 1));
    expect(csv.startsWith("monat,kunde,kuerzel,installationen,apps,")).toBe(true);
    expect(csv).toContain("\r\n2026-11,");
    expect(csv).not.toContain("Ingenieurbüro Kraft,kraft,0");
  });

  it("say so for an unknown object", async () => {
    const root = await oeffne("/kunden/gibt-es-nicht");
    expect(ueberschrift(root)).toBe("Nicht gefunden");
  });
});

// BAULISTE.md Z-304: the server pages show what the Zentrale's API has, facts included, and
// nothing invented for a server whose agent has not reported yet
describe("servers of the Zentrale", () => {
  const JETZT = Date.now();
  const mitFakten: ServerDerZentrale = {
    serverId: "s-fakten",
    name: "Neuer Server",
    art: "gemeinsam",
    kundeId: null,
    wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], von: "03:30", bis: "04:30" },
    angelegtAm: JETZT - 3600_000,
    beigetretenAm: JETZT - 3000_000,
    architektur: "arm64",
    agentVersion: "0.1.0",
    zertifikatGueltigBis: JETZT + 300 * 86_400_000,
    gesperrtAm: null,
    agent: { zustand: "verbunden", letzterHeartbeat: JETZT - 5000 },
    fakten: {
      zeit: JETZT,
      cpuKerne: 4,
      ramMb: 8192,
      platten: [{ mount: "/", gesamtMb: 81_920, freiMb: 40_960 }],
      architektur: "arm64",
      os: { name: "Debian GNU/Linux", version: "13" },
      kernel: { laeuft: "6.12.41+deb13-arm64", installiert: "6.12.48+deb13-arm64" },
      neustartNoetig: true,
      updatesAusstehend: 3,
      podman: "5.4.2",
      ipv4: ["203.0.113.10"],
      ipv6: [],
      ptr: { "203.0.113.10": "neu.example.org" },
      portsBelegt: [{ port: 22, proto: "tcp" }],
      port25Ausgehend: false,
      uhrzeitAbweichungMs: 12,
      bootId: "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4",
      gestartetAm: JETZT - 38 * 86_400_000,
      unattendedUpgrades: { installiert: true, aktiv: true, letzterLauf: JETZT - 3600_000 },
    },
    faktenAm: JETZT - 60_000,
    neustart: {
      noetig: true,
      plan: { art: "warten", grund: "sperrzeit", ab: JETZT + 2 * 86_400_000 },
      letzter: {
        auftragId: "n-1",
        zustand: "gescheitert",
        vonHand: false,
        angelegtAm: JETZT - 86_400_000,
        geaendertAm: JETZT - 86_000_000,
        fehler: "Neustart nicht erfolgt: Agent neu gestartet",
      },
    },
  };
  const ohneFakten: ServerDerZentrale = {
    ...mitFakten,
    serverId: "s-leer",
    name: "Leerer Server",
    architektur: null,
    agentVersion: null,
    beigetretenAm: null,
    agent: { zustand: "getrennt", letzterHeartbeat: null },
    fakten: null,
    faktenAm: null,
    neustart: { noetig: null, plan: { art: "warten", grund: "unbekannt" }, letzter: null },
  };
  const vorher = serverQuelle();
  beforeEach(() => {
    const liste = [ohneFakten, mitFakten];
    serverQuelleEinsetzen({
      liste: async () => ({ ok: true, status: 200, daten: liste }),
      server: async (id) => {
        const sv = liste.find((s) => s.serverId === id);
        return sv ? { ok: true, status: 200, daten: sv } : { ok: false, status: 404, fehler: "x" };
      },
      sperren: async () => ({ ok: false, status: 409, fehler: "x" }),
      neustart: async () => ({ ok: false, status: 409, fehler: "x" }),
    });
  });
  afterEach(() => serverQuelleEinsetzen(vorher));

  const zeileVon = (root: HTMLElement, name: string) =>
    [...root.querySelectorAll("tbody tr")].find((z) => z.textContent?.includes(name))?.textContent;

  it("list each with its facts, or says it has none", async () => {
    const root = await oeffne("/server");
    flush();
    await new Promise((fertig) => setTimeout(fertig, 0));
    const neu = zeileVon(root, "Neuer Server");
    expect(neu).toContain("neu.example.org · Debian GNU/Linux 13 · arm64");
    expect(neu).toContain("Neustart");
    expect(neu).toContain("50 %");
    const leer = zeileVon(root, "Leerer Server");
    expect(leer).toContain("noch keine Fakten");
    expect(leer).toContain("noch keine Meldung");
  });

  it("show the facts on the server page", async () => {
    const root = await oeffne("/server/s-fakten");
    flush();
    await new Promise((fertig) => setTimeout(fertig, 0));
    expect(ueberschrift(root)).toBe("Neuer Server");
    const text = root.textContent ?? "";
    for (const teil of [
      "läuft 6.12.41+deb13-arm64, installiert 6.12.48+deb13-arm64",
      "5.4.2, rootless",
      "203.0.113.10 → neu.example.org",
      "22/tcp",
      "Port 25 ausgehendgesperrt",
      // Z-701: the operating system and the reboot
      "unattended-upgradesan, zuletzt",
      "Ausstehende Pakete3",
      "Neustart nötigja, für Kernel 6.12.48+deb13-arm64",
      "Nächster Neustartwartet auf das Ende einer Sperrzeit",
      "Letzter Neustartgescheitert: Neustart nicht erfolgt: Agent neu gestartet",
    ])
      expect(text).toContain(teil);
    expect(text).not.toContain("Prüfungen");
  });

  // Z-702: the checks the Zentrale rated, each with what it measured; unknown is neither OK nor
  // "Prüfen"
  it("show the checks of the Zentrale on the server page", async () => {
    const mitPruefungen: ServerDerZentrale = {
      ...mitFakten,
      serverId: "s-pruefungen",
      pruefungen: [
        { pruefung: "platte", ergebnis: "gelb", platten: [{ mount: "/", prozent: 85.5 }], seit: 1 },
        { pruefung: "zertifikate", ergebnis: "unbekannt", zertifikate: null, seit: null },
        { pruefung: "backups", ergebnis: "gruen", alt: [], seit: null },
        {
          pruefung: "ports",
          ergebnis: "gelb",
          fremd: [{ port: 5432, proto: "tcp" }],
          seit: null,
        },
        { pruefung: "uhrzeit", ergebnis: "gruen", abweichungMs: 12, synchron: true, seit: null },
      ],
    };
    serverQuelleEinsetzen({
      ...serverQuelle(),
      server: async () => ({ ok: true, status: 200, daten: mitPruefungen }),
    });
    const root = await oeffne("/server/s-pruefungen");
    flush();
    await new Promise((fertig) => setTimeout(fertig, 0));
    const karte = [...root.querySelectorAll("section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes("Prüfungen"),
    );
    const text = karte?.textContent ?? "";
    for (const teil of [
      "Platte85,5 % belegt (Grenze 80 %)Prüfen",
      "Zertifikatenicht gemessen",
      "Backupsalle jünger als 26 hOK",
      "Offene Ports5432/tcp: in keinem ManifestPrüfen",
      "UhrzeitNTP synchron, Abweichung 12 msOK",
    ])
      expect(text).toContain(teil);
    expect(text).not.toContain("Kernel");
  });

  it("say unknown where the agent reported nothing, and 404 for a server that is not there", async () => {
    const root = await oeffne("/server/s-leer");
    flush();
    await new Promise((fertig) => setTimeout(fertig, 0));
    expect(root.textContent).toContain("Der Agent hat noch keine Fakten gemeldet.");
    expect(root.textContent).toContain("unbekannt");
    dispose();
    const fehlt = await oeffne("/server/gibt-es-nicht");
    flush();
    await new Promise((fertig) => setTimeout(fertig, 0));
    expect(ueberschrift(fehlt)).toBe("Nicht gefunden");
  });
});

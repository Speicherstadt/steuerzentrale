import { setLocale } from "@steuerzentrale/ui";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { apiApps, appsQuelle, appsQuelleEinsetzen } from "./daten/apps.ts";
import { apiBackups, backupQuelle, backupQuelleEinsetzen } from "./daten/backups.ts";
import {
  apiBenachrichtigungen,
  benachrichtigungsQuelle,
  benachrichtigungsQuelleEinsetzen,
} from "./daten/benachrichtigungen.ts";
import { apiBetrieb, betriebQuelle, betriebQuelleEinsetzen } from "./daten/betrieb.ts";
import {
  apiEinstellungen,
  einstellungenQuelle,
  einstellungenQuelleEinsetzen,
} from "./daten/einstellungen.ts";
import { apiIch, ichQuelleEinsetzen } from "./daten/ich.ts";
import {
  apiInstallationen,
  installationenQuelle,
  installationenQuelleEinsetzen,
} from "./daten/installationen.ts";
import { apiKunden, kundenQuelle, kundenQuelleEinsetzen } from "./daten/kunden.ts";
import { apiLeistungen, leistungenQuelle, leistungenQuelleEinsetzen } from "./daten/leistungen.ts";
import { apiMitglieder, mitgliederQuelleEinsetzen } from "./daten/mitglieder.ts";
import { bestand, bestandEinsetzen, ohneDemo } from "./daten/quelle.ts";
import { apiRolle, rollenQuelleEinsetzen } from "./daten/rolle.ts";
import { apiServer, serverQuelle, serverQuelleEinsetzen } from "./daten/server.ts";
import { apiSupport, supportQuelle, supportQuelleEinsetzen } from "./daten/support.ts";
import { aufraeumen, oeffne, warten } from "./seiten/test-dom.tsx";

/*
 * BAULISTE.md Z-406: signed in, no page shows a datum of the demo. Every source is the API's, as
 * main.tsx puts them in, against a Zentrale that has an operator and nothing else yet; no page may
 * then name a server, customer, installation, person or event of the demo operator.
 */

const LEER: Record<string, unknown> = {
  "/api/v1/ich": {
    nutzerId: "n1",
    name: "Ines Inhaber",
    email: "ines@teufel.test",
    rolle: "inhaber",
    faktor: "totp",
    betreiber: { betreiberId: "b1", name: "Teufel IT" },
  },
  "/api/v1/server": { server: [] },
  "/api/v1/installationen": { installationen: [] },
  "/api/v1/kunden": { kunden: [] },
  "/api/v1/mitglieder": { mitglieder: [] },
  "/api/v1/uebersicht": { eintraege: [] },
  "/api/v1/auftraege": { eintraege: [], weiter: null },
  "/api/v1/ereignisse": { eintraege: [], weiter: null },
  "/api/v1/audit": { eintraege: [], weiter: null },
  "/api/v1/backups": { installationen: [] },
  "/api/v1/backup-ziel": { endpunkt: null, region: null, bucket: null, zugangGesetzt: false },
  "/api/v1/apps": { apps: [] },
  "/api/v1/updates": { installationen: [] },
  "/api/v1/benachrichtigungen": { smtp: null, ruhezeit: null, empfaenger: [], zustellungen: [] },
  "/api/v1/support-zugaenge": { zugaenge: [] },
  "/api/v1/leistungen": { monat: "2026-11", kunden: [] },
};

/** Names of the demo operator (src/demo/) that must not show */
const DEMO = [
  "Beispiel-Hosting",
  "Jana Beispiel",
  "Ole Kamp",
  "IT Berger",
  "Studio Lind",
  "Schreinerei Holm",
  "Gemeinsamer Server",
  "Café Sonne",
  "berger-schreibzeug",
  "A-2318",
  "Belegt 0.10.0",
];

const SEITEN = [
  "/",
  "/server",
  "/installationen",
  "/kunden",
  "/auftraege",
  "/ereignisse",
  "/audit",
  "/einstellungen",
  "/updates",
  "/backups",
  "/support",
  "/leistungen",
  "/apps",
];

const vorher = {
  bestand: bestand(),
  betrieb: betriebQuelle(),
  server: serverQuelle(),
  installationen: installationenQuelle(),
  kunden: kundenQuelle(),
  einstellungen: einstellungenQuelle(),
  backups: backupQuelle(),
  benachrichtigungen: benachrichtigungsQuelle(),
  apps: appsQuelle(),
  support: supportQuelle(),
  leistungen: leistungenQuelle(),
};

beforeAll(() => {
  bestandEinsetzen(ohneDemo);
  betriebQuelleEinsetzen(apiBetrieb);
  serverQuelleEinsetzen(apiServer);
  installationenQuelleEinsetzen(apiInstallationen);
  kundenQuelleEinsetzen(apiKunden);
  einstellungenQuelleEinsetzen(apiEinstellungen);
  rollenQuelleEinsetzen(apiRolle);
  ichQuelleEinsetzen(apiIch);
  mitgliederQuelleEinsetzen(apiMitglieder);
  backupQuelleEinsetzen(apiBackups);
  benachrichtigungsQuelleEinsetzen(apiBenachrichtigungen);
  appsQuelleEinsetzen(apiApps);
  supportQuelleEinsetzen(apiSupport);
  leistungenQuelleEinsetzen(apiLeistungen);
});

afterAll(() => {
  bestandEinsetzen(vorher.bestand);
  betriebQuelleEinsetzen(vorher.betrieb);
  serverQuelleEinsetzen(vorher.server);
  installationenQuelleEinsetzen(vorher.installationen);
  kundenQuelleEinsetzen(vorher.kunden);
  einstellungenQuelleEinsetzen(vorher.einstellungen);
  backupQuelleEinsetzen(vorher.backups);
  benachrichtigungsQuelleEinsetzen(vorher.benachrichtigungen);
  appsQuelleEinsetzen(vorher.apps);
  supportQuelleEinsetzen(vorher.support);
  leistungenQuelleEinsetzen(vorher.leistungen);
});

beforeEach(() => {
  setLocale("de", { reload: false });
  vi.stubGlobal("fetch", async (pfad: string) => {
    const ohneAbfrage = String(pfad).split("?")[0] ?? "";
    const daten = LEER[ohneAbfrage];
    return daten
      ? Response.json(daten)
      : Response.json({ fehler: "nicht_gefunden" }, { status: 404 });
  });
});

afterEach(() => {
  aufraeumen();
  vi.unstubAllGlobals();
});

describe("signed in, against a Zentrale without data", () => {
  it.each(SEITEN)("%s shows no datum of the demo", async (pfad) => {
    const { root } = await oeffne(pfad);
    await vi.waitFor(() => {
      if (!root.querySelector("main h1")) throw new Error("no heading yet");
    });
    await warten();
    const text = root.textContent ?? "";
    for (const name of DEMO) expect(text, name).not.toContain(name);
    // the sidebar names the operator and the account of the Zentrale
    expect(text).toContain("Teufel IT");
    expect(text).toContain("Ines Inhaber");
  });

  it("says on the overview that nothing needs attention", async () => {
    const { root } = await oeffne("/");
    await vi.waitFor(() => {
      if (!root.textContent?.includes("Nichts zu tun")) throw new Error("not yet");
    });
    expect(root.textContent).toContain("Keine Ereignisse.");
    expect(root.textContent).toContain("Keine Aufträge.");
    expect(root.textContent).toContain("0 Installationen bekommen eine neuere Version");
    expect(root.textContent).toContain("Letzter Lauf erfolgreich0/0");
  });

  it("shows the services of the Zentrale and downloads the month from it (Z-804)", async () => {
    const { root } = await oeffne("/leistungen");
    await vi.waitFor(() => {
      if (!root.textContent?.includes("Keine Kunden.")) throw new Error("not yet");
    });
    const link = root.querySelector<HTMLAnchorElement>("a[download]");
    expect(link?.getAttribute("href")).toMatch(
      /^\/api\/v1\/leistungen\?monat=\d{4}-\d{2}&format=csv$/,
    );
  });

  it("names an app the interface does not describe by its id in the services", async () => {
    const leer = LEER["/api/v1/leistungen"];
    const v = { minuten: 60, gemessen: 60, anteil: 1 };
    LEER["/api/v1/leistungen"] = {
      monat: "2026-11",
      kunden: [
        {
          kundeId: "k1",
          name: "Kanzlei Nord",
          kuerzel: "nord",
          installationen: [
            {
              installationId: "probe-1",
              app: "probe",
              speicherBytes: 1024 ** 3,
              verfuegbarkeit: { ...v, jahr: 2026, monat: 11, rot: 0 },
            },
          ],
          speicherBytes: 1024 ** 3,
          supportMinuten: 30,
          verfuegbarkeit: v,
        },
      ],
    };
    try {
      const { root } = await oeffne("/leistungen");
      await vi.waitFor(() => {
        if (!root.textContent?.includes("Kanzlei Nord")) throw new Error("not yet");
      });
      const zeile = root.querySelector("main tbody tr")?.textContent ?? "";
      expect(zeile).toContain("probe");
      expect(zeile).toContain("100,00");
      expect(zeile).toContain("1,0");
    } finally {
      LEER["/api/v1/leistungen"] = leer;
    }
  });

  it("shows the support accesses of the Zentrale: none yet (Z-802)", async () => {
    const { root } = await oeffne("/support");
    await vi.waitFor(() => {
      if (!root.textContent?.includes("Gerade kein Zugang aktiv.")) throw new Error("not yet");
    });
    expect(root.textContent).toContain("Noch keiner beendet.");
    expect(root.textContent).not.toContain("Z-802");
  });

  it("shows the updates of the Zentrale: none yet, without a word of Z-503", async () => {
    const { root } = await oeffne("/updates");
    await vi.waitFor(() => {
      if (!root.textContent?.includes("Noch keine Installation.")) throw new Error("not yet");
    });
    expect(root.textContent).not.toContain("Z-503");
  });
});

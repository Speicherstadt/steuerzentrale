import { setLocale } from "@steuerzentrale/ui";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { apiApps, appsQuelle, appsQuelleEinsetzen } from "./daten/apps.ts";
import { apiBackups, backupQuelle, backupQuelleEinsetzen } from "./daten/backups.ts";
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
import { apiMitglieder, mitgliederQuelleEinsetzen } from "./daten/mitglieder.ts";
import { bestand, bestandEinsetzen, ohneDemo } from "./daten/quelle.ts";
import { apiRolle, rolleLesen, rollenQuelleEinsetzen } from "./daten/rolle.ts";
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
  "/api/v1/support-zugaenge": { zugaenge: [] },
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
  apps: appsQuelle(),
  support: supportQuelle(),
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
  appsQuelleEinsetzen(apiApps);
  supportQuelleEinsetzen(apiSupport);
});

afterAll(() => {
  bestandEinsetzen(vorher.bestand);
  betriebQuelleEinsetzen(vorher.betrieb);
  serverQuelleEinsetzen(vorher.server);
  installationenQuelleEinsetzen(vorher.installationen);
  kundenQuelleEinsetzen(vorher.kunden);
  einstellungenQuelleEinsetzen(vorher.einstellungen);
  backupQuelleEinsetzen(vorher.backups);
  appsQuelleEinsetzen(vorher.apps);
  supportQuelleEinsetzen(vorher.support);
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

  it("says which item brings a page without an API", async () => {
    const { root } = await oeffne("/leistungen");
    await vi.waitFor(() => {
      if (!root.textContent?.includes("kommt mit Z-804")) throw new Error("not yet");
    });
    expect((await rolleLesen()).ok).toBe(true);
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

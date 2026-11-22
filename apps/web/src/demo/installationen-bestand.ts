import { EINRICHTUNG_AKTIONEN, type PlatzInstallation } from "@steuerzentrale/manifest";
import type { AuftragDerInstallation, InstallationMitAuftraegen } from "../daten/installationen.ts";
import type { Installation } from "../daten/typen.ts";
import { apps } from "./apps.ts";
import { demoFelder } from "./einstellungen.ts";
import { installationen } from "./installationen.ts";
import { demoHealth, ohneMeldung } from "./installationen-health.ts";
import { ausDemoApp } from "./platz.ts";

/*
 * The demo's installations as the Zentrale's API shows them (Z-402): each fixture of
 * installationen.ts set up with its finished setup job and its state (Z-403), and one whose setup
 * failed, so the demo shows the way out of that state. Placement counts each with what the demo
 * knows of its app.
 */

export type Eintrag = { i: InstallationMitAuftraegen; platz: PlatzInstallation; bietet: string[] };

export const nachAuftrag = (
  id: string,
  aktion: string,
  zustand: AuftragDerInstallation["zustand"],
  t: number,
  fehler: string | null = null,
): AuftragDerInstallation => ({
  auftragId: `${id}-${aktion}`,
  aktion,
  zustand,
  fortschritt: null,
  fehler,
  angelegtAm: t,
  geaendertAm: t,
});

const PORT = 20000;

const ausFixture = (i: Installation, n: number, jetzt: number): Eintrag => ({
  i: {
    ...demoHealth(
      i,
      apps.find((a) => a.id === i.app),
      jetzt,
    ),
    installationId: i.id,
    kundeId: i.kunde,
    serverId: i.server,
    app: i.app,
    version: i.version,
    manifestHash: "0".repeat(64),
    host: i.adresse,
    httpPort: PORT + n,
    ports: {},
    optionen: i.optionen,
    einstellungen: { betreiber: {}, installation: i.werte },
    zustand: "laeuft",
    angelegtVon: "demo",
    angelegtAm: i.laeuftSeit,
    geaendertAm: i.laeuftSeit,
    auftraege: [nachAuftrag(i.id, EINRICHTUNG_AKTIONEN.einrichten, "erfolgreich", i.laeuftSeit)],
    formular: {
      felder: demoFelder(
        apps.find((a) => a.id === i.app),
        "installation",
      ),
      gesetzt: [],
    },
  },
  platz: ausDemoApp(
    i.kunde,
    apps.find((a) => a.id === i.app),
  ),
  bietet: [],
});

/** The failed setup of Fotografie Aust's Belegt: the image could not be pulled */
export const GESCHEITERT = "aust-belegt";

const gescheitert = (jetzt: number): Eintrag => {
  const t = jetzt - 2 * 3_600_000;
  return {
    i: {
      installationId: GESCHEITERT,
      kundeId: "aust",
      serverId: "shared-2",
      app: "belegt",
      version: "0.10.0",
      manifestHash: "0".repeat(64),
      host: "belegt.aust.beispiel-hosting.de",
      httpPort: PORT + installationen.length,
      ports: {},
      optionen: [],
      einstellungen: { betreiber: {}, installation: {} },
      zustand: "gescheitert",
      health: ohneMeldung(),
      verlauf: [],
      angelegtVon: "demo",
      angelegtAm: t,
      geaendertAm: t + 240_000,
      auftraege: [
        nachAuftrag(GESCHEITERT, EINRICHTUNG_AKTIONEN.einrichten, "gescheitert", t, "image ziehen"),
        nachAuftrag(GESCHEITERT, "pforte_route_setzen", "abgebrochen", t),
      ],
      formular: { felder: [], gesetzt: [] },
    },
    platz: { kundeId: "aust", ramMb: 0, platteGb: 0, festePorts: [], serverFuerSich: false },
    bietet: [],
  };
};

export const startbestand = (jetzt: number): Eintrag[] => [
  ...installationen.map((i, n) => ausFixture(i, n, jetzt)),
  gescheitert(jetzt),
];

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Einrichtung,
  type Manifest,
  manifestPruefen,
  snapshotArgument,
  type Wert,
} from "@steuerzentrale/manifest";
import { angeboteneVersionen, updatePlan } from "@steuerzentrale/planung";
import { autoWerteErzeugen } from "../../zentrale/src/modules/installationen/werte.ts";
import { faellig, planInstallation } from "../../zentrale/src/modules/updates/plan.ts";
import { ersetzen } from "./einrichtung-hilfen.ts";

/*
 * Helpers of the test with the real apps (BAULISTE.md Z-1003): their manifests read from
 * manifeste/ (signed with the test key by the test, einrichtung-hilfen.ts `signiert`), the values a
 * new installation gets as the Zentrale makes them (auto values generated once, werte.ts; the
 * operator's ELSTER manufacturer ID), and the update plan the Zentrale reads (modules/updates,
 * plan.ts) for one installation, with the maintenance window the whole day.
 */

const MANIFESTE = join(import.meta.dirname, "../../../manifeste");

/** The manifest of manifeste/<app>/<version>/ as text */
export const echtesManifest = (app: string, version: string): string =>
  readFileSync(join(MANIFESTE, app, version, "manifest.yml"), "utf8");

export const gelesen = (text: string): Manifest => {
  const g = manifestPruefen(text);
  if (!g.ok) throw new Error(g.fehler.join("\n"));
  return g.manifest;
};

/**
 * The manifest without a health check, judged by its units only (BAULISTE.md Z-1003, "Haben ohne
 * Health"). Haben names /api/health since 0.12.0 (manifeste/haben/*\/QUELLEN.md), so the test
 * takes it out to cover an app without one (docs/plan.md, "Entscheidungen", "Echte Apps (Z-1003)")
 */
export const ohneHealth = (text: string, hinweis: string): string =>
  ersetzen(
    text,
    "health: { art: http, dienst: app, pfad: /api/health }",
    `health: { art: keine, hinweis: "${hinweis}" }`,
  );

/** Haben's test manufacturer ID (Speicherstadt/haben, packages/elster/src/xml.ts, TEST_HERSTELLER_ID) */
export const HERSTELLER_ID = "74931";

/** The values of a new installation on its port: auto values generated, the operator's given */
export const einrichtungFuer = (
  m: Manifest,
  port: number,
  betreiber: Record<string, Wert> = {},
): Einrichtung => ({
  installation: {
    kundeId: "k-test",
    optionen: [],
    httpPort: port,
    ports: {},
    host: `${port}.sz-test.example`,
    ipv4: null,
  },
  einstellungen: {
    betreiber,
    installation: {},
    auto: autoWerteErzeugen(m, [], (n) => new Uint8Array(randomBytes(n))),
  },
});

export type LaufTeil = { tag: string; ok: boolean; snapshot?: string };

/** The arguments of a restore or update from the parts of a run, as the Zentrale makes them */
export const snapshotArgumente = (teile: LaufTeil[]): Record<string, string> =>
  Object.fromEntries(
    teile
      .filter((t) => !t.tag.startsWith("befehl:"))
      .map((t) => [snapshotArgument(t.tag), t.snapshot ?? ""]),
  );

const GANZER_TAG = JSON.stringify({ tage: [0, 1, 2, 3, 4, 5, 6], von: "00:00", bis: "00:00" });

/**
 * The Zentrale's plan for one running installation of an internal customer (it runs a
 * pre-release, docs/plan.md "Interne Kunden und Vorabversionen") towards the newest version it is
 * offered among `neue`: the version, its wave entry and whether the loop would start it now
 */
export const planFuer = (installationId: string, alt: string, neue: string[], jetzt: number) => {
  const altM = gelesen(alt);
  const kopf = neue.map((text) => ({ text, m: gelesen(text) }));
  const ziel = angeboteneVersionen(
    { version: altM.version, intern: true },
    kopf.map(({ m }) => ({ version: m.version, dringend: false })),
  )[0];
  if (!ziel) throw new Error(`no newer version for ${altM.id} ${altM.version}`);
  const neu = kopf.find(({ m }) => m.version === ziel.version)?.m as Manifest;
  const laufend = {
    installationId,
    serverId: "s-test",
    app: altM.id,
    version: altM.version,
    manifest: alt,
    intern: true,
    wartungsfenster: GANZER_TAG,
  };
  const [eintrag] = updatePlan([planInstallation(laufend, neu)], ziel, {}, [], jetzt);
  if (!eintrag) throw new Error("no plan entry");
  const zeile = {
    ...eintrag,
    serverId: "s-test",
    app: altM.id,
    version: ziel.version,
    dringend: false,
  };
  return { version: ziel.version, eintrag, faellig: faellig(zeile, jetzt) };
};

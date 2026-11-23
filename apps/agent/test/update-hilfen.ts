import { UPDATE_AKTION, UPDATE_ZEITLIMIT_S, updateDatenLesen } from "@steuerzentrale/manifest";
import { expect } from "vitest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import {
  EINRICHTUNG,
  einrichtenAuftrag,
  HOME,
  MANIFEST,
  NAME,
} from "../src/einrichtung/testauftraege.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import type { Agent } from "./pruef-restore-hilfen.ts";
import { SNAPSHOT_A } from "./wiederherstellen-hilfen.ts";

/*
 * Helpers of the unit tests of updating (Z-503) on a server in memory: the setup tests' manifest
 * as version 2.0.0 with another image digest, the job of an update to it with the snapshot of the
 * backup made just before, the result read as the Zentrale reads it, and the files of the
 * installation's units.
 */

export const IMAGE_NEU = `localhost:5000/beispiel@sha256:${"b".repeat(64)}`;
export const UNITS_ORDNER = `${HOME}/.config/containers/systemd`;
export const APP_CONTAINER = `${UNITS_ORDNER}/${NAME}-app.container`;

/** A manifest of the example app as another version, with the image of that version */
export const version = (v: string, manifest = MANIFEST): string =>
  ersetzen(manifest, 'version: "1.0.0"', `version: "${v}"`).replaceAll(
    `sha256:${"a".repeat(64)}`,
    `sha256:${"b".repeat(64)}`,
  );

export const NEU = version("2.0.0");

export const update = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "u1",
    aktion: UPDATE_AKTION,
    argumente: { "snapshot:volume:daten": SNAPSHOT_A },
    manifest: NEU,
    signatur: signiert(NEU),
    einrichtung: EINRICHTUNG,
    zeitlimitS: UPDATE_ZEITLIMIT_S,
    ...teil,
  });

type Ergebnis = { ok: boolean; daten?: unknown; fehler?: string };

/** An update's data, exactly as the Zentrale reads them (updateDatenLesen) */
export const updateDaten = (a: Pick<Agent, "ergebnis">) => {
  const e = a.ergebnis() as Ergebnis;
  if (!e.ok) throw new Error(e.fehler);
  const gelesen = updateDatenLesen(e.daten);
  if (gelesen === null) throw new Error(`no update result: ${JSON.stringify(e.daten)}`);
  expect(e.daten).toEqual(gelesen);
  return gelesen;
};

/** The files of the installation's units with their content */
export const unitDateien = (a: Pick<Agent, "sys">) =>
  Object.fromEntries(
    a.sys
      .unter(UNITS_ORDNER)
      .map((p) => [p.slice(UNITS_ORDNER.length + 1), a.sys.dateien.get(p)?.inhalt]),
  );

/** The version the app's unit names in its labels: the version that runs */
export const laufendeVersion = (a: Pick<Agent, "sys">): string | undefined =>
  a.sys.dateien.get(APP_CONTAINER)?.inhalt?.match(/\.version=([0-9.]+)/)?.[1];

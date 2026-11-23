import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import {
  backups,
  betreiber,
  ereignisse,
  fakten,
  heartbeats,
  installationVerlauf,
  logAuszuege,
  zustellungen,
} from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import type { AufbewahrteTabelle } from "../audit/tabellen.ts";
import { aufbewahrungsGrenzen, TAG_MS } from "./grenzen.ts";

export type Geloescht = Record<AufbewahrteTabelle, number>;

/** Every operator with rows, also one already deleted from `betreiber`: its old rows go too */
const betreiberMitDaten = (db: Db): Set<string> =>
  new Set(
    [
      betreiber,
      heartbeats,
      fakten,
      logAuszuege,
      installationVerlauf,
      ereignisse,
      backups,
      zustellungen,
    ].flatMap((tabelle) =>
      db
        .selectDistinct({ betreiberId: tabelle.betreiberId })
        .from(tabelle)
        .all()
        .map((zeile) => zeile.betreiberId),
    ),
  );

/** One retention run for every operator, each in its own transaction with its audit entries */
export const aufbewahren = (db: Db, schreibDb: SchreibDb, jetzt: number): Geloescht => {
  const grenzen = aufbewahrungsGrenzen(jetzt);
  const summe: Geloescht = {
    heartbeats: 0,
    fakten: 0,
    logAuszuege: 0,
    zustellungen: 0,
    installationVerlauf: 0,
    ereignisse: 0,
    backups: 0,
    pruefRestores: 0,
  };
  for (const betreiberId of betreiberMitDaten(db)) {
    const kontext = { betreiberId, akteur: "system", jetzt, grund: "Aufbewahrung (docs/plan.md)" };
    schreiben(schreibDb, kontext, "aufbewahrung", (s) => {
      for (const name of Object.keys(grenzen) as AufbewahrteTabelle[])
        summe[name] += s.loeschenVor(name, grenzen[name]);
    });
  }
  return summe;
};

export type Planer = (lauf: () => void, ms: number) => void;

/** Runs the retention now and then once a day */
export const aufbewahrungsSchleife = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: () => number,
  planen: Planer,
  log: (zeile: string) => void,
): void => {
  const lauf = () => {
    try {
      const geloescht = aufbewahren(db, schreibDb, jetzt());
      log(JSON.stringify({ msg: "retention", geloescht }));
    } catch (fehler) {
      log(JSON.stringify({ msg: "retention failed", fehler: String(fehler) }));
    }
  };
  lauf();
  planen(lauf, TAG_MS);
};

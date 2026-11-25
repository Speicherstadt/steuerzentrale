import {
  aussenBewerten,
  aussenFortschreiben,
  type Probe,
  stundeVon,
} from "@steuerzentrale/planung";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { aussenSetzen } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import { standVon } from "../bewertung/lesen.ts";
import { stoerungFortschreiben } from "../bewertung/stoerung.ts";
import { type Aufgabe, dienstAufgaben } from "../dienste/pruefen.ts";
import { aussenMelden } from "./ereignisse.ts";
import { aussenStandLesen } from "./lesen.ts";
import type { Sonde } from "./sonde.ts";
import { type Pruefziel, pruefziele } from "./ziele.ts";

/*
 * The check from outside every minute (BAULISTE.md Z-704; docs/plan.md, "Prüfung von außen"):
 * every running installation with an HTTP service and every observed service (Z-1101,
 * modules/dienste), at most `PARALLEL` at a time; each result is
 * kept as a measurement with its hour's count for the availability, then a change is reported
 * (ereignisse.ts) and a fault begins or ends (modules/bewertung/stoerung.ts, inside and outside
 * together). A run that is still going when the next is due makes that one fall out: the minutes
 * it missed count as not measured.
 */

export const AUSSEN_PRUEFUNG_MS = 60_000;
export const PARALLEL = 8;

/** Each step's time limit; a whole check takes at most their sum */
export const ZEITLIMIT_MS = { dns: 5_000, tls: 10_000, http: 10_000 };

export type AussenDeps = {
  db: Db;
  schreibDb: SchreibDb;
  sonde: Sonde;
  now: () => number;
  log: (zeile: string) => void;
  neueId?: () => string;
};

/** Keeps one check's result and writes what follows from it */
export const ergebnisAnnehmen = (
  deps: AussenDeps,
  ziel: Pruefziel,
  probe: Probe,
  jetzt: number,
): void => {
  const i = ziel.installation;
  const wer = { betreiberId: i.betreiberId, installationId: i.installationId };
  const alt = aussenStandLesen(deps.db, wer.betreiberId, wer.installationId);
  const { stand } = aussenFortschreiben(
    alt,
    aussenBewerten(probe, ziel.soll, ziel.erwartung),
    jetzt,
  );
  aussenSetzen(
    deps.schreibDb,
    {
      ...wer,
      zustand: stand.zustand === "rot" ? "rot" : "gruen",
      grund: JSON.stringify(stand.grund),
      seit: stand.seit,
      geprueftAm: stand.geprueftAm,
      ergebnis: JSON.stringify(probe),
    },
    stundeVon(jetzt),
  );
  const innen = standVon(i);
  aussenMelden(deps, i, stand, innen, jetzt);
  stoerungFortschreiben(deps.db, deps.schreibDb, wer, innen, jetzt, deps.neueId);
};

const installationsAufgabe = (deps: AussenDeps, ziel: Pruefziel): Aufgabe => ({
  host: ziel.installation.host,
  pfad: ziel.pfad,
  wer: {
    betreiberId: ziel.installation.betreiberId,
    installationId: ziel.installation.installationId,
  },
  annehmen: (probe, jetzt) => ergebnisAnnehmen(deps, ziel, probe, jetzt),
});

const aufgabePruefen = async (deps: AussenDeps, a: Aufgabe): Promise<void> => {
  const probe = await deps.sonde(a.host, a.pfad);
  a.annehmen(probe, deps.now());
};

/** Checks every installation and observed service due, `PARALLEL` at a time; returns how many */
export const aussenPruefen = async (deps: AussenDeps): Promise<number> => {
  const aufgaben = [
    ...pruefziele(deps.db).map((ziel) => installationsAufgabe(deps, ziel)),
    ...dienstAufgaben(deps),
  ];
  const warteschlange = [...aufgaben];
  const arbeiter = async () => {
    for (let a = warteschlange.shift(); a; a = warteschlange.shift()) {
      try {
        await aufgabePruefen(deps, a);
      } catch (fehler) {
        deps.log(
          JSON.stringify({ msg: "check from outside failed", ...a.wer, fehler: String(fehler) }),
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, aufgaben.length) }, arbeiter));
  return aufgaben.length;
};

/** Checks every minute from now on; a run still going makes the next fall out */
export const aussenSchleife = (deps: AussenDeps, planen: Planer): void => {
  let laeuft = false;
  planen(() => {
    if (laeuft) return;
    laeuft = true;
    aussenPruefen(deps)
      .catch((fehler) =>
        deps.log(JSON.stringify({ msg: "checks from outside failed", fehler: String(fehler) })),
      )
      .finally(() => {
        laeuft = false;
      });
  }, AUSSEN_PRUEFUNG_MS);
};

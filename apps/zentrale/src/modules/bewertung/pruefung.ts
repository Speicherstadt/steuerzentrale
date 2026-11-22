import { type Bewertungsstand, nachFrist } from "@steuerzentrale/planung";
import { isNotNull } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { installationen } from "../../db/schema.ts";
import { bewertungSetzen } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import { standVon } from "./lesen.ts";
import { stoerungFortschreiben, type Wer } from "./stoerung.ts";

/*
 * The check of ratings every 30 seconds (BAULISTE.md Z-403), like the check for silent servers
 * (modules/verbindung/stille.ts): an installation without a report for 90 s becomes unknown, set
 * as a change with its history row, and a fault begins or ends; the same runs at every report
 * (melden.ts). The time is handed in, so the tests pass five minutes without waiting.
 */
export const BEWERTUNG_PRUEFUNG_MS = 30_000;

/**
 * The stored rating after the 90-second rule: when the report is overdue, the change to unknown is
 * stored (at the moment it was due) and returned
 */
export const fristAnwenden = (
  schreibDb: SchreibDb,
  wer: Wer,
  stand: Bewertungsstand,
  meldung: string | null,
  jetzt: number,
): Bewertungsstand => {
  const aktuell = nachFrist(stand, jetzt);
  if (aktuell.bewertung === stand.bewertung) return stand;
  bewertungSetzen(schreibDb, {
    ...wer,
    bewertung: aktuell.bewertung,
    grund: JSON.stringify(aktuell.grund),
    seit: aktuell.seit,
    gemeldetAm: aktuell.gemeldetAm,
    meldung,
    wechsel: true,
  });
  return aktuell;
};

export type Geprueft = { unbekannt: number; stoerungen: number; behoben: number };

/** Checks every installation that was rated once, of every operator */
export const bewertungenPruefen = (db: Db, schreibDb: SchreibDb, jetzt: number): Geprueft => {
  const ergebnis: Geprueft = { unbekannt: 0, stoerungen: 0, behoben: 0 };
  const bewertet = db
    .select()
    .from(installationen)
    .where(isNotNull(installationen.bewertung))
    .all()
    .filter((i) => i.zustand !== "entfernt");
  for (const i of bewertet) {
    const stand = standVon(i);
    if (!stand) continue;
    const wer = { betreiberId: i.betreiberId, installationId: i.installationId };
    const aktuell = fristAnwenden(schreibDb, wer, stand, i.meldung, jetzt);
    if (aktuell !== stand) ergebnis.unbekannt += 1;
    const stoerung = stoerungFortschreiben(db, schreibDb, wer, aktuell, jetzt);
    if (stoerung === "stoerung") ergebnis.stoerungen += 1;
    if (stoerung === "behoben") ergebnis.behoben += 1;
  }
  return ergebnis;
};

/** Checks every 30 seconds, from now on */
export const bewertungsSchleife = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: () => number,
  planen: Planer,
  log: (zeile: string) => void,
): void => {
  planen(() => {
    try {
      const geprueft = bewertungenPruefen(db, schreibDb, jetzt());
      if (geprueft.unbekannt + geprueft.stoerungen + geprueft.behoben > 0)
        log(JSON.stringify({ msg: "ratings checked", ...geprueft }));
    } catch (fehler) {
      log(JSON.stringify({ msg: "rating check failed", fehler: String(fehler) }));
    }
  }, BEWERTUNG_PRUEFUNG_MS);
};

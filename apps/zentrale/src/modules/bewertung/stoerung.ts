import { randomUUID } from "node:crypto";
import { type Bewertungsstand, stoerungPruefen } from "@steuerzentrale/planung";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { schreiben } from "../audit/index.ts";
import { BEHOBEN_ART, STOERUNG_ART, stoerungOffen, zielVon } from "./lesen.ts";
import { grundText } from "./text.ts";

/*
 * A fault of an installation (BAULISTE.md Z-403; docs/plan.md, "Störung"): five minutes of
 * continuous red make the event `stoerung` (severity `fehler`), green after it `stoerung_behoben`
 * (`info`), both through `schreiben`. Whether one is open the events themselves tell, so a restart
 * of the Zentrale neither repeats nor forgets one.
 */

export type Wer = { betreiberId: string; installationId: string };

const text = (wer: Wer, stand: Bewertungsstand, jetzt: number, art: string) =>
  art === STOERUNG_ART
    ? `Störung ${wer.installationId}: seit ${Math.floor((jetzt - stand.seit) / 60_000)} Min. rot; ${grundText(stand.grund)}`
    : `Störung ${wer.installationId} behoben: wieder grün`;

/** Writes the event a fault's start or end calls for; returns which, if any */
export const stoerungFortschreiben = (
  db: Db,
  schreibDb: SchreibDb,
  wer: Wer,
  stand: Bewertungsstand,
  jetzt: number,
  neueId: () => string = randomUUID,
): "stoerung" | "behoben" | undefined => {
  const offen = stoerungOffen(db, wer.betreiberId, wer.installationId);
  const ergebnis = stoerungPruefen(stand, offen, jetzt);
  if (!ergebnis) return undefined;
  const art = ergebnis === "stoerung" ? STOERUNG_ART : BEHOBEN_ART;
  const kontext = {
    betreiberId: wer.betreiberId,
    akteur: "system",
    jetzt,
    grund: ergebnis === "stoerung" ? "Installation 5 Min. rot" : "Installation wieder grün",
  };
  schreiben(schreibDb, kontext, `ereignis.${art.replace("_", "-")}`, (s) =>
    s.einfuegen("ereignisse", {
      betreiberId: wer.betreiberId,
      ereignisId: neueId(),
      zeitpunkt: jetzt,
      art,
      schwere: ergebnis === "stoerung" ? "fehler" : "info",
      ziel: zielVon(wer.installationId),
      text: text(wer, stand, jetzt, art),
    }),
  );
  return ergebnis;
};

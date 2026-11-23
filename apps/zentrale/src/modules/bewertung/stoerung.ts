import { randomUUID } from "node:crypto";
import {
  type AussenStand,
  type Bewertungsstand,
  rotSeit5Min,
  stoerungPruefen,
} from "@steuerzentrale/planung";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { schreiben } from "../audit/index.ts";
import { aussenStandLesen } from "../aussen/lesen.ts";
import { aussenGrundText } from "../aussen/text.ts";
import { BEHOBEN_ART, STOERUNG_ART, stoerungOffen, zielVon } from "./lesen.ts";
import { grundText } from "./text.ts";

/*
 * A fault of an installation (BAULISTE.md Z-403, Z-704; docs/plan.md, "Störung"): five minutes of
 * continuous red inside (the agent's rating) or outside (the Zentrale's own check) make the event
 * `stoerung` (severity `fehler`), green on both sides after it `stoerung_behoben` (`info`), both
 * through `schreiben`. Whether one is open the events themselves tell, so a restart of the Zentrale
 * neither repeats nor forgets one.
 */

export type Wer = { betreiberId: string; installationId: string };

const minuten = (jetzt: number, seit: number) => Math.floor((jetzt - seit) / 60_000);

const stoerungText = (
  wer: Wer,
  innen: Bewertungsstand | null,
  aussen: AussenStand | null,
  jetzt: number,
) =>
  rotSeit5Min(innen, aussen, jetzt) === "aussen" && aussen
    ? `Störung ${wer.installationId}: seit ${minuten(jetzt, aussen.seit)} Min. außen rot; ${aussenGrundText(aussen.grund)}`
    : `Störung ${wer.installationId}: seit ${minuten(jetzt, innen?.seit ?? jetzt)} Min. rot; ${innen ? grundText(innen.grund) : ""}`;

/** Writes the event a fault's start or end calls for; returns which, if any */
export const stoerungFortschreiben = (
  db: Db,
  schreibDb: SchreibDb,
  wer: Wer,
  stand: Bewertungsstand | null,
  jetzt: number,
  neueId: () => string = randomUUID,
): "stoerung" | "behoben" | undefined => {
  const offen = stoerungOffen(db, wer.betreiberId, wer.installationId);
  const aussen = aussenStandLesen(db, wer.betreiberId, wer.installationId);
  const ergebnis = stoerungPruefen(stand, offen, jetzt, aussen);
  if (!ergebnis) return undefined;
  const art = ergebnis === "stoerung" ? STOERUNG_ART : BEHOBEN_ART;
  const seite = rotSeit5Min(stand, aussen, jetzt) === "aussen" ? "außen " : "";
  const kontext = {
    betreiberId: wer.betreiberId,
    akteur: "system",
    jetzt,
    grund: ergebnis === "stoerung" ? `Installation 5 Min. ${seite}rot` : "Installation wieder grün",
  };
  schreiben(schreibDb, kontext, `ereignis.${art.replace("_", "-")}`, (s) =>
    s.einfuegen("ereignisse", {
      betreiberId: wer.betreiberId,
      ereignisId: neueId(),
      zeitpunkt: jetzt,
      art,
      schwere: ergebnis === "stoerung" ? "fehler" : "info",
      ziel: zielVon(wer.installationId),
      text:
        ergebnis === "stoerung"
          ? stoerungText(wer, stand, aussen, jetzt)
          : `Störung ${wer.installationId} behoben: wieder grün`,
    }),
  );
  return ergebnis;
};

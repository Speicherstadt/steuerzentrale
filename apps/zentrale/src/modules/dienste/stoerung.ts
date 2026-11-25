import { rotSeit5Min, stoerungPruefen } from "@steuerzentrale/planung";
import { BEHOBEN_ART, STOERUNG_ART, stoerungOffenAm } from "../bewertung/lesen.ts";
import { grundText as innenGrundText } from "../bewertung/text.ts";
import { type DienstDeps, ereignis, grundText } from "./ereignis.ts";
import { type DienstZeile, dienstInnenLesen, dienstStandLesen, dienstZiel } from "./lesen.ts";

/*
 * A fault of an observed service (BAULISTE.md Z-1101, Z-1103), by the same rule as an
 * installation's (packages/planung, stoerungPruefen): five minutes red outside or, where the agent
 * reads its units, inside make the event `stoerung`; green on both sides (or a side never measured)
 * `stoerung_behoben`. Whether one is open the events tell.
 */

const minuten = (jetzt: number, seit: number) => Math.floor((jetzt - seit) / 60_000);

/** Writes the event a fault's start or end calls for; returns which, if any */
export const dienstStoerungFortschreiben = (
  deps: DienstDeps,
  d: DienstZeile,
  jetzt: number,
): "stoerung" | "behoben" | undefined => {
  const innen = d.serverId === null ? null : dienstInnenLesen(deps.db, d.betreiberId, d.dienstId);
  const aussen = dienstStandLesen(deps.db, d.betreiberId, d.dienstId);
  const offen = stoerungOffenAm(deps.db, d.betreiberId, dienstZiel(d.dienstId));
  const ergebnis = stoerungPruefen(innen, offen, jetzt, aussen);
  if (ergebnis === "stoerung") {
    const seite = rotSeit5Min(innen, aussen, jetzt);
    const text =
      seite === "aussen" && aussen
        ? `seit ${minuten(jetzt, aussen.seit)} Min. außen rot; ${grundText(aussen.grund)}`
        : `seit ${minuten(jetzt, innen?.seit ?? jetzt)} Min. innen rot; ${innen ? innenGrundText(innen.grund) : ""}`;
    ereignis(deps, d, jetzt, {
      aktion: "stoerung",
      grund: `Dienst 5 Min. ${seite === "aussen" ? "außen" : "innen"} rot`,
      art: STOERUNG_ART,
      schwere: "fehler",
      text: `Störung ${d.name}: ${text}`,
    });
  }
  if (ergebnis === "behoben")
    ereignis(deps, d, jetzt, {
      aktion: "stoerung-behoben",
      grund: "Dienst wieder grün",
      art: BEHOBEN_ART,
      schwere: "info",
      text: `Störung ${d.name} behoben: wieder grün`,
    });
  return ergebnis;
};

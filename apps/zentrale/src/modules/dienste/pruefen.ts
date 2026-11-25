import { randomUUID } from "node:crypto";
import {
  type AussenGrund,
  type AussenStand,
  aussenBewerten,
  aussenFortschreiben,
  aussenMeldungPruefen,
  type Probe,
  stoerungPruefen,
  stundeVon,
} from "@steuerzentrale/planung";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { dienstAussenSetzen, schreiben } from "../audit/index.ts";
import { AUSSEN_GRUEN_ART, AUSSEN_ROT_ART, letzteAussenMeldungAm } from "../aussen/lesen.ts";
import { aussenGrundText } from "../aussen/text.ts";
import { BEHOBEN_ART, STOERUNG_ART, stoerungOffenAm } from "../bewertung/lesen.ts";
import { type DienstZeile, diensteZuPruefen, dienstStandLesen, dienstZiel } from "./lesen.ts";

/*
 * The check from outside of an observed service (BAULISTE.md Z-1101), in the same run as the
 * installations' (modules/aussen/pruefen.ts) and rated by the same pure functions (packages/planung):
 * DNS, certificate, connection and its health path, 200–399 healthy as an installation's health path.
 * The addresses are not compared with any server's: the service may sit behind Cloudflare. With no
 * agent inside, the fault is red outside for five minutes alone. Events `aussen_rot`,
 * `aussen_gruen`, `stoerung` and `stoerung_behoben` carry the target `dienst:<id>` and go to the
 * recipients like any other; no job is ever made.
 */

type Deps = { db: Db; schreibDb: SchreibDb; neueId?: () => string };

/** The reason in German for an event; there is no Pforte in front of an observed service */
const grundText = (g: AussenGrund): string =>
  g.code === "pforte" ? `Verbindung: ${g.werte.fehler ?? ""}` : aussenGrundText(g);

const ereignis = (
  deps: Deps,
  d: DienstZeile,
  jetzt: number,
  e: {
    aktion: string;
    grund: string;
    art: string;
    schwere: "info" | "warn" | "fehler";
    text: string;
  },
) =>
  schreiben(
    deps.schreibDb,
    { betreiberId: d.betreiberId, akteur: "system", jetzt, grund: e.grund },
    `ereignis.${e.aktion}`,
    (s) =>
      s.einfuegen("ereignisse", {
        betreiberId: d.betreiberId,
        ereignisId: (deps.neueId ?? randomUUID)(),
        zeitpunkt: jetzt,
        art: e.art,
        schwere: e.schwere,
        ziel: dienstZiel(d.dienstId),
        text: e.text,
      }),
  );

const wechselMelden = (deps: Deps, d: DienstZeile, stand: AussenStand, jetzt: number) => {
  const letzte = letzteAussenMeldungAm(deps.db, d.betreiberId, dienstZiel(d.dienstId));
  const meldung = aussenMeldungPruefen(stand, letzte, jetzt);
  if (meldung === "rot")
    ereignis(deps, d, jetzt, {
      aktion: "aussen-rot",
      grund: "von außen rot",
      art: AUSSEN_ROT_ART,
      schwere: "warn",
      text: `Von außen rot: ${d.name} (${d.host}): ${grundText(stand.grund)}`,
    });
  if (meldung === "gruen")
    ereignis(deps, d, jetzt, {
      aktion: "aussen-gruen",
      grund: "von außen wieder grün",
      art: AUSSEN_GRUEN_ART,
      schwere: "info",
      text: `Von außen wieder grün: ${d.name} (${d.host})`,
    });
};

const stoerungMelden = (deps: Deps, d: DienstZeile, stand: AussenStand, jetzt: number) => {
  const offen = stoerungOffenAm(deps.db, d.betreiberId, dienstZiel(d.dienstId));
  const ergebnis = stoerungPruefen(null, offen, jetzt, stand);
  const minuten = Math.floor((jetzt - stand.seit) / 60_000);
  if (ergebnis === "stoerung")
    ereignis(deps, d, jetzt, {
      aktion: "stoerung",
      grund: "Dienst 5 Min. außen rot",
      art: STOERUNG_ART,
      schwere: "fehler",
      text: `Störung ${d.name}: seit ${minuten} Min. außen rot; ${grundText(stand.grund)}`,
    });
  if (ergebnis === "behoben")
    ereignis(deps, d, jetzt, {
      aktion: "stoerung-behoben",
      grund: "Dienst wieder grün",
      art: BEHOBEN_ART,
      schwere: "info",
      text: `Störung ${d.name} behoben: wieder grün`,
    });
};

/** Keeps one check's result of a service and writes what follows from it */
export const dienstErgebnisAnnehmen = (
  deps: Deps,
  d: DienstZeile,
  probe: Probe,
  jetzt: number,
): void => {
  const alt = dienstStandLesen(deps.db, d.betreiberId, d.dienstId);
  const { stand } = aussenFortschreiben(alt, aussenBewerten(probe, null, "health"), jetzt);
  dienstAussenSetzen(
    deps.schreibDb,
    {
      betreiberId: d.betreiberId,
      dienstId: d.dienstId,
      zustand: stand.zustand === "rot" ? "rot" : "gruen",
      grund: JSON.stringify(stand.grund),
      seit: stand.seit,
      geprueftAm: stand.geprueftAm,
      ergebnis: JSON.stringify(probe),
    },
    stundeVon(jetzt),
  );
  wechselMelden(deps, d, stand, jetzt);
  stoerungMelden(deps, d, stand, jetzt);
};

/** One check to run: which host and path, what to log, and how to keep the answer */
export type Aufgabe = {
  host: string;
  pfad: string;
  wer: Record<string, string>;
  annehmen: (probe: Probe, jetzt: number) => void;
};

/** The checks of every observed service not removed, of every operator */
export const dienstAufgaben = (deps: Deps): Aufgabe[] =>
  diensteZuPruefen(deps.db).map((d) => ({
    host: d.host,
    pfad: d.pfad,
    wer: { betreiberId: d.betreiberId, dienstId: d.dienstId },
    annehmen: (probe, jetzt) => dienstErgebnisAnnehmen(deps, d, probe, jetzt),
  }));

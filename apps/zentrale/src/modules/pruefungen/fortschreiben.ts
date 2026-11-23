import { randomUUID } from "node:crypto";
import { befundFortschreiben, type Serverpruefung, serverPruefen } from "@steuerzentrale/planung";
import { and, isNotNull, isNull } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { server } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import type { Server } from "../server/index.ts";
import { pruefEingabe } from "./eingabe.ts";
import { befundArt, behobenArt, offenerBefund, zielVon } from "./lesen.ts";
import { befundText, behobenText } from "./text.ts";

/*
 * The checks of every server, every minute (BAULISTE.md Z-702; docs/plan.md, "Prüfungen eines
 * Servers"), like the check for silent servers (modules/verbindung/stille.ts): for each joined
 * server that is not revoked, of every operator, a check that turns yellow or red, or red after
 * yellow, writes the event `pruefung_<name>` (warn or fehler), and green after it
 * `pruefung_<name>_behoben` (info), through `schreiben`: one per finding, not per run, which is what
 * Z-703 notifies from. The time is handed in, so the tests pass days without waiting.
 */
export const PRUEFUNGEN_MS = 60_000;

export type Fortgeschrieben = { auffaellig: number; behoben: number };

const SCHWERE = { gelb: "warn", rot: "fehler" } as const;

/** Writes the event a check's result calls for; returns which, if any */
const pruefungFortschreiben = (
  db: Db,
  schreibDb: SchreibDb,
  sv: Server,
  p: Serverpruefung,
  jetzt: number,
  neueId: () => string,
): "auffaellig" | "behoben" | undefined => {
  const schritt = befundFortschreiben(offenerBefund(db, sv, p.pruefung)?.stufe ?? null, p.ergebnis);
  if (!schritt) return undefined;
  const auffaellig = schritt.art === "auffaellig";
  const kontext = {
    betreiberId: sv.betreiberId,
    akteur: "system",
    jetzt,
    grund: auffaellig ? `Prüfung ${p.pruefung}: ${p.ergebnis}` : `Prüfung ${p.pruefung}: grün`,
  };
  schreiben(schreibDb, kontext, `ereignis.pruefung-${p.pruefung}`, (s) =>
    s.einfuegen("ereignisse", {
      betreiberId: sv.betreiberId,
      ereignisId: neueId(),
      zeitpunkt: jetzt,
      art: auffaellig ? befundArt(p.pruefung) : behobenArt(p.pruefung),
      schwere: auffaellig ? SCHWERE[schritt.stufe] : "info",
      ziel: zielVon(sv.serverId),
      text: auffaellig ? befundText(sv.name, p, jetzt) : behobenText(sv.name, p.pruefung),
    }),
  );
  return schritt.art;
};

/** Checks every joined, unrevoked server of every operator and writes the events */
export const pruefungenFortschreiben = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: number,
  neueId: () => string = randomUUID,
): Fortgeschrieben => {
  const ergebnis: Fortgeschrieben = { auffaellig: 0, behoben: 0 };
  const kandidaten = db
    .select()
    .from(server)
    .where(and(isNotNull(server.beigetretenAm), isNull(server.gesperrtAm)))
    .all();
  for (const sv of kandidaten)
    for (const p of serverPruefen(pruefEingabe(db, sv, jetzt))) {
      const schritt = pruefungFortschreiben(db, schreibDb, sv, p, jetzt, neueId);
      if (schritt) ergebnis[schritt] += 1;
    }
  return ergebnis;
};

/** Checks every minute, from now on */
export const pruefungsSchleife = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: () => number,
  planen: Planer,
  log: (zeile: string) => void,
): void => {
  planen(() => {
    try {
      const geschrieben = pruefungenFortschreiben(db, schreibDb, jetzt());
      if (geschrieben.auffaellig + geschrieben.behoben > 0)
        log(JSON.stringify({ msg: "server checks", ...geschrieben }));
    } catch (fehler) {
      log(JSON.stringify({ msg: "server check failed", fehler: String(fehler) }));
    }
  }, PRUEFUNGEN_MS);
};

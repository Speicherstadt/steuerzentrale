import { randomUUID } from "node:crypto";
import { and, isNull, lte } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { supportZugaenge } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import { nameVon } from "./lesen.ts";
import { abgelaufenText, ENDE_ART } from "./texte.ts";

/*
 * A support access ends by itself (BAULISTE.md Z-802): the guard refuses it from the millisecond of
 * its end on, whatever runs here. This loop only writes the event of that end for the customer,
 * once per access (`ende_gemeldet_am`), with the instant it ran out; an access ended by hand has
 * its event already.
 */

export const ABLAUF_PRUEFUNG_MS = 60_000;

/** Writes the event of every access that ran out and has none yet; returns how many */
export const abgelaufeneMelden = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: number,
  neueId: () => string = randomUUID,
): number => {
  const faellig = db
    .select()
    .from(supportZugaenge)
    .where(
      and(
        isNull(supportZugaenge.beendetAm),
        isNull(supportZugaenge.endeGemeldetAm),
        lte(supportZugaenge.ende, jetzt),
      ),
    )
    .all();
  for (const z of faellig) {
    const kontext = {
      betreiberId: z.betreiberId,
      akteur: "system",
      jetzt,
      grund: "Support-Zugang abgelaufen",
    };
    schreiben(schreibDb, kontext, "support.abgelaufen", (w) => {
      w.aendern("supportZugaenge", { zugangId: z.zugangId }, { endeGemeldetAm: jetzt });
      w.einfuegen("ereignisse", {
        betreiberId: z.betreiberId,
        ereignisId: neueId(),
        zeitpunkt: z.ende,
        art: ENDE_ART,
        schwere: "info",
        ziel: `installation:${z.installationId}`,
        text: abgelaufenText(nameVon(db, z.nutzerId), z.ende - z.beginn),
      });
    });
  }
  return faellig.length;
};

/** Every minute: the events of the accesses that ran out */
export const supportSchleife = (
  db: Db,
  schreibDb: SchreibDb,
  now: () => number,
  planen: Planer,
  log: (zeile: string) => void,
): void => {
  planen(() => {
    try {
      const gemeldet = abgelaufeneMelden(db, schreibDb, now());
      if (gemeldet > 0) log(JSON.stringify({ msg: "support accesses ran out", gemeldet }));
    } catch (fehler) {
      log(JSON.stringify({ msg: "support access check failed", fehler: String(fehler) }));
    }
  }, ABLAUF_PRUEFUNG_MS);
};

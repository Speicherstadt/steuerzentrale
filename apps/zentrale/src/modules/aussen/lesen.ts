import {
  type AussenGrund,
  type AussenStand,
  aussenJetzt,
  letzteMonate,
  type MonatsVerfuegbarkeit,
  monatsGrenzen,
  type TagesVerfuegbarkeit,
  verfuegbarkeitImMonat,
  verfuegbarkeitProTag,
} from "@steuerzentrale/planung";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { aussenPruefungen, ereignisse, verfuegbarkeit } from "../../db/schema.ts";

/*
 * Reading the checks from outside (BAULISTE.md Z-704), always within one operator: the newest at
 * the installation, the hourly counts for the availability per month, the last report of a change
 * in the events (so a restart of the Zentrale neither repeats nor forgets one, like a fault).
 */

export const AUSSEN_ROT_ART = "aussen_rot";
export const AUSSEN_GRUEN_ART = "aussen_gruen";

/** How many months the page shows: the current one and the twelve before (the retention's 13) */
export const MONATE = 13;

const grundLesen = (text: string): AussenGrund => {
  const g = JSON.parse(text) as Partial<AussenGrund>;
  return { code: g.code ?? "keine_pruefung", werte: g.werte ?? {} };
};

/** The hourly counts of an installation from `von` on, within its operator */
const scheibenLesen = (db: Db, betreiberId: string, installationId: string, von: number) =>
  db
    .select({
      stunde: verfuegbarkeit.stunde,
      gemessen: verfuegbarkeit.gemessen,
      rot: verfuegbarkeit.rot,
    })
    .from(verfuegbarkeit)
    .where(
      and(
        eq(verfuegbarkeit.betreiberId, betreiberId),
        eq(verfuegbarkeit.installationId, installationId),
        gte(verfuegbarkeit.stunde, von),
      ),
    )
    .all();

const zeileLesen = (db: Db, betreiberId: string, installationId: string) =>
  db
    .select()
    .from(aussenPruefungen)
    .where(
      and(
        eq(aussenPruefungen.betreiberId, betreiberId),
        eq(aussenPruefungen.installationId, installationId),
      ),
    )
    .get();

/** The state from outside as last stored, or null before the first check */
export const aussenStandLesen = (
  db: Db,
  betreiberId: string,
  installationId: string,
): AussenStand | null => {
  const z = zeileLesen(db, betreiberId, installationId);
  return z
    ? { zustand: z.zustand, grund: grundLesen(z.grund), seit: z.seit, geprueftAm: z.geprueftAm }
    : null;
};

/** The last change reported from outside: `rot`, `gruen`, or null before any */
export const letzteAussenMeldung = (
  db: Db,
  betreiberId: string,
  installationId: string,
): "rot" | "gruen" | null => {
  const art = db
    .select({ art: ereignisse.art })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, betreiberId),
        eq(ereignisse.ziel, `installation:${installationId}`),
        inArray(ereignisse.art, [AUSSEN_ROT_ART, AUSSEN_GRUEN_ART]),
      ),
    )
    // in the same millisecond, green counts as later, as a fix does for a fault
    .orderBy(desc(ereignisse.zeitpunkt), ereignisse.art)
    .get()?.art;
  if (art === undefined) return null;
  return art === AUSSEN_ROT_ART ? "rot" : "gruen";
};

export type AussenAntwort = {
  aussen: (AussenStand & { ergebnis: unknown }) | null;
  verfuegbarkeit: MonatsVerfuegbarkeit[];
};

/** The state from outside now, with what each step answered, and the availability of 13 months */
export const aussenLesen = (
  db: Db,
  betreiberId: string,
  installationId: string,
  jetzt: number,
): AussenAntwort => {
  const z = zeileLesen(db, betreiberId, installationId);
  const monate = letzteMonate(jetzt, MONATE);
  const aeltester = monate.at(-1);
  const von = aeltester ? monatsGrenzen(aeltester).von : jetzt;
  const scheiben = scheibenLesen(db, betreiberId, installationId, von);
  const stand = z && {
    zustand: z.zustand,
    grund: grundLesen(z.grund),
    seit: z.seit,
    geprueftAm: z.geprueftAm,
  };
  return {
    aussen: stand && z ? { ...aussenJetzt(stand, jetzt), ergebnis: JSON.parse(z.ergebnis) } : null,
    verfuegbarkeit: monate.map((m) => verfuegbarkeitImMonat(scheiben, m, jetzt)),
  };
};

/** At most as many days as the hourly counts are kept: 13 months (src/modules/aufbewahrung) */
export const TAGE_MAX = 400;

/** The availability of each of the last `tage` days in Berlin, today included, oldest first */
export const tageLesen = (
  db: Db,
  betreiberId: string,
  installationId: string,
  tage: number,
  jetzt: number,
): TagesVerfuegbarkeit[] => {
  const leer = verfuegbarkeitProTag([], tage, jetzt);
  const von = leer[0]?.von ?? jetzt;
  return verfuegbarkeitProTag(scheibenLesen(db, betreiberId, installationId, von), tage, jetzt);
};

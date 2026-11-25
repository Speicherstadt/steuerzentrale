import {
  type AussenStand,
  aussenJetzt,
  type BewertungJetzt,
  type Bewertungsstand,
  bewertungJetzt,
  letzteMonate,
  type MonatsVerfuegbarkeit,
  monatsGrenzen,
  verfuegbarkeitImMonat,
} from "@steuerzentrale/planung";
import { and, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { dienste, dienstInnen, dienstPruefungen, dienstVerfuegbarkeit } from "../../db/schema.ts";
import { grundLesen } from "../aussen/lesen.ts";
import { type Innen, innenVon } from "./innen.ts";

/*
 * Reading observed services (BAULISTE.md Z-1101), always within one operator: the service, its
 * newest check from outside (unknown after three minutes without one, as for an installation) and
 * its availability in the current month from the hourly counts, and on an observed server the
 * rating of its units inside (Z-1103). A removed service is not read.
 */

export type DienstZeile = typeof dienste.$inferSelect;

export type Dienst = {
  id: string;
  name: string;
  /** `https://<host>`, as entered */
  adresse: string;
  host: string;
  pfad: string;
  kundeId: string | null;
  angelegtAm: number;
  /** The state from outside now, null before the first check */
  aussen: AussenStand | null;
  /** The current month up to now */
  verfuegbarkeit: MonatsVerfuegbarkeit;
  /** What the agent reads inside (Z-1103), null when only checked from outside */
  innen: Innen | null;
  /** The rating inside now; null without `innen` */
  innenStand: BewertungJetzt | null;
};

/** The event target of a service: its events and faults carry it */
export const dienstZiel = (dienstId: string) => `dienst:${dienstId}`;

/** The state from outside as last stored, or null before the first check */
export const dienstStandLesen = (
  db: Db,
  betreiberId: string,
  dienstId: string,
): AussenStand | null => {
  const z = db
    .select()
    .from(dienstPruefungen)
    .where(
      and(eq(dienstPruefungen.betreiberId, betreiberId), eq(dienstPruefungen.dienstId, dienstId)),
    )
    .get();
  return z
    ? { zustand: z.zustand, grund: grundLesen(z.grund), seit: z.seit, geprueftAm: z.geprueftAm }
    : null;
};

/** The rating inside as last stored (Z-1103), or null before the first report */
export const dienstInnenLesen = (
  db: Db,
  betreiberId: string,
  dienstId: string,
): Bewertungsstand | null => {
  const z = db
    .select()
    .from(dienstInnen)
    .where(and(eq(dienstInnen.betreiberId, betreiberId), eq(dienstInnen.dienstId, dienstId)))
    .get();
  if (!z) return null;
  const g = JSON.parse(z.grund) as Partial<Bewertungsstand["grund"]>;
  return {
    bewertung: z.bewertung,
    grund: { code: g.code ?? "noch_keine_meldung", werte: g.werte ?? {} },
    seit: z.seit,
    gemeldetAm: z.gemeldetAm,
  };
};

const monatLesen = (
  db: Db,
  betreiberId: string,
  dienstId: string,
  jetzt: number,
): MonatsVerfuegbarkeit => {
  const [monat] = letzteMonate(jetzt, 1);
  if (!monat) throw new Error("no month");
  const scheiben = db
    .select({
      stunde: dienstVerfuegbarkeit.stunde,
      gemessen: dienstVerfuegbarkeit.gemessen,
      rot: dienstVerfuegbarkeit.rot,
    })
    .from(dienstVerfuegbarkeit)
    .where(
      and(
        eq(dienstVerfuegbarkeit.betreiberId, betreiberId),
        eq(dienstVerfuegbarkeit.dienstId, dienstId),
        gte(dienstVerfuegbarkeit.stunde, monatsGrenzen(monat).von),
      ),
    )
    .all();
  return verfuegbarkeitImMonat(scheiben, monat, jetzt);
};

const alsDienst = (db: Db, z: DienstZeile, jetzt: number): Dienst => {
  const stand = dienstStandLesen(db, z.betreiberId, z.dienstId);
  const innen = innenVon(z);
  return {
    id: z.dienstId,
    name: z.name,
    adresse: `https://${z.host}`,
    host: z.host,
    pfad: z.pfad,
    kundeId: z.kundeId,
    angelegtAm: z.angelegtAm,
    aussen: stand && aussenJetzt(stand, jetzt),
    verfuegbarkeit: monatLesen(db, z.betreiberId, z.dienstId, jetzt),
    innen,
    innenStand: innen && bewertungJetzt(dienstInnenLesen(db, z.betreiberId, z.dienstId), jetzt),
  };
};

/** The row of a service not removed, within its operator */
export const dienstZeileLesen = (
  db: Db,
  betreiberId: string,
  dienstId: string,
): DienstZeile | undefined =>
  db
    .select()
    .from(dienste)
    .where(
      and(
        eq(dienste.betreiberId, betreiberId),
        eq(dienste.dienstId, dienstId),
        isNull(dienste.entferntAm),
      ),
    )
    .get();

/** The operator's services not removed, by name */
export const diensteListe = (db: Db, betreiberId: string, jetzt: number): Dienst[] =>
  db
    .select()
    .from(dienste)
    .where(and(eq(dienste.betreiberId, betreiberId), isNull(dienste.entferntAm)))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name, "de"))
    .map((z) => alsDienst(db, z, jetzt));

export const dienstLesen = (
  db: Db,
  betreiberId: string,
  dienstId: string,
  jetzt: number,
): Dienst | undefined => {
  const z = dienstZeileLesen(db, betreiberId, dienstId);
  return z && alsDienst(db, z, jetzt);
};

/** Every service to check now, of every operator */
export const diensteZuPruefen = (db: Db): DienstZeile[] =>
  db.select().from(dienste).where(isNull(dienste.entferntAm)).all();

/** The services not removed whose units the agent of this server reads (Z-1103) */
export const diensteAufServer = (db: Db, betreiberId: string, serverId: string): DienstZeile[] =>
  db
    .select()
    .from(dienste)
    .where(
      and(
        eq(dienste.betreiberId, betreiberId),
        eq(dienste.serverId, serverId),
        isNull(dienste.entferntAm),
      ),
    )
    .all();

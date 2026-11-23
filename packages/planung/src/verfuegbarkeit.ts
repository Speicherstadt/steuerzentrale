import { instantVon, ortszeit } from "./zeit.ts";

/*
 * The availability of an installation per month (BAULISTE.md Z-704; docs/plan.md, "Verfügbarkeit"):
 * the share of the checks from outside, one a minute, that were green. The checks are kept as
 * slices of one UTC hour each (how many, how many red); a month is a calendar month in
 * Europe/Berlin, and as Berlin is always a whole number of hours from UTC, every slice lies within
 * one month. A minute without a check (the Zentrale down, a run that overran) counts neither way:
 * the share is of the minutes measured, and how many were is said beside it.
 */

export const STUNDE_MS = 3_600_000;

/** Each check stands for this many minutes: the interval of the checks from outside */
export const PRUEF_MINUTEN = 1;

export type Pruefergebnis = { zeitpunkt: number; zustand: "gruen" | "rot" };

/** The checks of one UTC hour of one installation */
export type Zeitscheibe = { stunde: number; gemessen: number; rot: number };

export type Monat = { jahr: number; monat: number };

export const stundeVon = (instant: number): number => Math.floor(instant / STUNDE_MS) * STUNDE_MS;

/** The slice with one more check, a new one when there was none for its hour */
export const scheibeFortschreiben = (
  alt: Zeitscheibe | undefined,
  zeitpunkt: number,
  zustand: Pruefergebnis["zustand"],
): Zeitscheibe => ({
  stunde: stundeVon(zeitpunkt),
  gemessen: (alt?.gemessen ?? 0) + 1,
  rot: (alt?.rot ?? 0) + (zustand === "rot" ? 1 : 0),
});

/** A series of checks as slices, oldest first */
export const inScheiben = (ergebnisse: readonly Pruefergebnis[]): Zeitscheibe[] => {
  const scheiben = new Map<number, Zeitscheibe>();
  for (const e of ergebnisse) {
    const stunde = stundeVon(e.zeitpunkt);
    scheiben.set(stunde, scheibeFortschreiben(scheiben.get(stunde), e.zeitpunkt, e.zustand));
  }
  return [...scheiben.values()].sort((a, b) => a.stunde - b.stunde);
};

/** The month in Berlin an instant falls in */
export const monatVon = (instant: number): Monat => {
  const o = ortszeit(instant);
  return { jahr: o.jahr, monat: o.monat };
};

/** From local midnight on the first to local midnight on the first of the next month */
export const monatsGrenzen = (m: Monat): { von: number; bis: number } => ({
  von: instantVon(m.jahr, m.monat, 1, 0, 0),
  bis: instantVon(m.monat === 12 ? m.jahr + 1 : m.jahr, m.monat === 12 ? 1 : m.monat + 1, 1, 0, 0),
});

export const imMonat = (stunde: number, g: { von: number; bis: number }): boolean =>
  stunde >= g.von && stunde < g.bis;

/** The month of `jetzt` and the `anzahl - 1` before it, newest first */
export const letzteMonate = (jetzt: number, anzahl: number): Monat[] => {
  const { jahr, monat } = monatVon(jetzt);
  return Array.from({ length: anzahl }, (_, n) => {
    const index = jahr * 12 + (monat - 1) - n;
    return { jahr: Math.floor(index / 12), monat: (index % 12) + 1 };
  });
};

export type MonatsVerfuegbarkeit = Monat & {
  /** Minutes of the month up to `jetzt` */
  minuten: number;
  /** Minutes with a check */
  gemessen: number;
  /** Minutes with a red check */
  rot: number;
  /** Green of measured, 0 to 1; null without any check */
  anteil: number | null;
};

/** The availability in a month, counted up to `jetzt` for the current one */
export const verfuegbarkeitImMonat = (
  scheiben: readonly Zeitscheibe[],
  m: Monat,
  jetzt: number,
): MonatsVerfuegbarkeit => {
  const g = monatsGrenzen(m);
  const drin = scheiben.filter((s) => imMonat(s.stunde, g));
  const gemessen = drin.reduce((summe, s) => summe + s.gemessen, 0) * PRUEF_MINUTEN;
  const rot = drin.reduce((summe, s) => summe + s.rot, 0) * PRUEF_MINUTEN;
  const ende = Math.max(g.von, Math.min(g.bis, jetzt));
  return {
    ...m,
    minuten: Math.round((ende - g.von) / 60_000),
    gemessen,
    rot,
    anteil: gemessen === 0 ? null : (gemessen - rot) / gemessen,
  };
};

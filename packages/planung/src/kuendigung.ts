import { tagesbeginn } from "./zeit.ts";

/*
 * What follows the end of a contract (BAULISTE.md Z-604; docs/plan.md, "Kündigung und Löschung"),
 * as pure functions of the contract's end and the clock. The end is the start of a day in
 * Europe/Berlin (docs/kunden.md); the deadlines are calendar days in Berlin from it, so a change
 * of daylight saving time in between moves neither by an hour: 30 days read only and the archive
 * for the customer, deletion at the start of the 90th day after the end.
 */

export const NUR_LESEN_TAGE = 30;
export const LOESCHFRIST_TAGE = 90;

/** The longest a pre-signed S3 link can live: seven days (AWS SigV4, `X-Amz-Expires`) */
export const LINK_MAX_MS = 7 * 24 * 3600_000;

export type Fristen = {
  /** From the end until here the apps are read only and the archive may be handed out */
  nurLesenBis: number;
  /** From here the installations, repositories, S3 accesses and DNS records are deleted */
  loeschenAb: number;
};

export const fristen = (ende: number): Fristen => ({
  nurLesenBis: tagesbeginn(ende, NUR_LESEN_TAGE),
  loeschenAb: tagesbeginn(ende, LOESCHFRIST_TAGE),
});

/**
 * Where a contract stands: `laeuft` without an end or before it, `nur_lesen` in the 30 days after
 * it, `wartet` until the deletion, `loeschen` from then on
 */
export type Vertragsphase = "laeuft" | "nur_lesen" | "wartet" | "loeschen";

export const vertragsphase = (ende: number | null, jetzt: number): Vertragsphase => {
  if (ende === null || jetzt < ende) return "laeuft";
  const f = fristen(ende);
  if (jetzt >= f.loeschenAb) return "loeschen";
  return jetzt < f.nurLesenBis ? "nur_lesen" : "wartet";
};

/**
 * Until when a link to the archive made now is valid: seven days at most and never past the end
 * of the 30 days; undefined once they are over or before the contract ended
 */
export const linkGueltigBis = (ende: number | null, jetzt: number): number | undefined => {
  if (vertragsphase(ende, jetzt) !== "nur_lesen" || ende === null) return undefined;
  return Math.min(jetzt + LINK_MAX_MS, fristen(ende).nurLesenBis);
};

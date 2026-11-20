import type { AufbewahrteTabelle } from "../audit/tabellen.ts";

export const TAG_MS = 24 * 60 * 60 * 1000;

/** `jetzt` minus whole calendar months in UTC; the 31st of a shorter month becomes its last day */
export const monateZurueck = (jetzt: number, monate: number): number => {
  const datum = new Date(jetzt);
  const ziel = new Date(
    Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth() - monate, 1, 0, 0, 0, 0),
  );
  const letzterTag = new Date(
    Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Date.UTC(
    ziel.getUTCFullYear(),
    ziel.getUTCMonth(),
    Math.min(datum.getUTCDate(), letzterTag),
    datum.getUTCHours(),
    datum.getUTCMinutes(),
    datum.getUTCSeconds(),
    datum.getUTCMilliseconds(),
  );
};

/**
 * What is older than these instants goes (docs/plan.md, "Daten der Zentrale"): heartbeats and log
 * excerpts after 30 days, events after 13 months; the audit log stays for good and is not here
 */
export const aufbewahrungsGrenzen = (jetzt: number): Record<AufbewahrteTabelle, number> => ({
  heartbeats: jetzt - 30 * TAG_MS,
  logAuszuege: jetzt - 30 * TAG_MS,
  ereignisse: monateZurueck(jetzt, 13),
});

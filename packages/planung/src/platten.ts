import { STUNDE_MS, stundeVon } from "./verfuegbarkeit.ts";

/*
 * How full a server's disks were over time (docs/plan.md, "Server"; the tab "Auslastung" of a
 * server's page): the agent reports its disks with its facts every 15 minutes (Z-304), the Zentrale
 * keeps them 30 days. Per UTC hour and mount point the fullest reading of that hour, in percent of
 * the disk's size; a reading without disks (the agent could not read them) adds nothing.
 */

/** A disk as the agent reports it in its facts */
export type PlatteGemessen = { mount: string; gesamtMb: number; freiMb: number };

/** One report of the facts: when, and its disks (null: the agent could not read them) */
export type PlattenMessung = { zeitpunkt: number; platten: PlatteGemessen[] | null };

export type PlattenStunde = { stunde: number; platten: { mount: string; prozent: number }[] };

/** At most as many days as the facts are kept (src/modules/aufbewahrung in apps/zentrale) */
export const PLATTEN_TAGE_MAX = 30;

const belegt = (p: PlatteGemessen): number | null =>
  p.gesamtMb > 0 ? Math.round(((p.gesamtMb - p.freiMb) / p.gesamtMb) * 1000) / 10 : null;

const hoechstes = (werte: Map<string, number>, mount: string, prozent: number) => {
  const alt = werte.get(mount);
  if (alt === undefined || prozent > alt) werte.set(mount, prozent);
};

/** The fullest reading per hour and mount point, the hours oldest first, the mounts by name */
export const plattenProStunde = (messungen: readonly PlattenMessung[]): PlattenStunde[] => {
  const stunden = new Map<number, Map<string, number>>();
  for (const m of messungen) {
    for (const p of m.platten ?? []) {
      const prozent = belegt(p);
      if (prozent === null) continue;
      const stunde = stundeVon(m.zeitpunkt);
      const werte = stunden.get(stunde) ?? new Map<string, number>();
      hoechstes(werte, p.mount, prozent);
      stunden.set(stunde, werte);
    }
  }
  return [...stunden.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stunde, werte]) => ({
      stunde,
      platten: [...werte.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mount, prozent]) => ({ mount, prozent })),
    }));
};

/** The first instant of the `tage` days before `jetzt`: the hour `tage` × 24 hours back */
export const plattenVon = (tage: number, jetzt: number): number =>
  stundeVon(jetzt) - (tage * 24 - 1) * STUNDE_MS;

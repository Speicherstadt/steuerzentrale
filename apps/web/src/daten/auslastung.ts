import type { PlattenStunde } from "@steuerzentrale/planung";
import { BEREICH_MS, type Bereich } from "./messwerte.ts";

/*
 * The tab "Auslastung" of a server as data (docs/plan.md, "Server und Kunden (Oberfläche
 * 2026-11)"): how full each disk was, from the hours the Zentrale keeps of the agent's facts
 * (GET /api/v1/server/:id/platten). A range of 24 hours shows each hour, 7 days four hours a
 * point, 30 days a day a point, each the fullest reading in it, so a short peak is not averaged
 * away. CPU and memory are not reported by the agent and have no series.
 */

const STUNDE_MS = 3_600_000;

/** How long one point of the range lasts */
export const SCHRITT_MS: Record<Bereich, number> = {
  "24h": STUNDE_MS,
  "7t": 4 * STUNDE_MS,
  "30t": 24 * STUNDE_MS,
};

export type Punkt = { zeitpunkt: number; wert: number };

export type PlattenReihe = {
  mount: string;
  punkte: Punkt[];
  /** The newest hour's value, and how the first point of the range changed to the last */
  aktuell: number | null;
  aenderung: number | null;
};

const reiheVon = (mount: string, stunden: PlattenStunde[], von: number, schritt: number) => {
  const fach = new Map<number, number>();
  for (const s of stunden) {
    const wert = s.platten.find((p) => p.mount === mount)?.prozent;
    if (wert === undefined) continue;
    const n = Math.max(0, Math.floor((s.stunde - von) / schritt));
    fach.set(n, Math.max(fach.get(n) ?? 0, wert));
  }
  return [...fach.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, wert]) => ({ zeitpunkt: von + (n + 0.5) * schritt, wert }));
};

/** Per mount point the fullest value of each step in the range up to `jetzt`, oldest first */
export const plattenReihen = (
  stunden: PlattenStunde[],
  bereich: Bereich,
  jetzt: number,
): PlattenReihe[] => {
  const von = jetzt - BEREICH_MS[bereich];
  const drin = stunden.filter((s) => s.stunde + STUNDE_MS > von && s.stunde <= jetzt);
  const mounts = [...new Set(drin.flatMap((s) => s.platten.map((p) => p.mount)))].sort();
  return mounts.map((mount) => {
    const punkte = reiheVon(mount, drin, von, SCHRITT_MS[bereich]).map((p) => ({
      ...p,
      zeitpunkt: Math.min(p.zeitpunkt, jetzt),
    }));
    const erster = punkte[0];
    const neu = punkte.at(-1);
    const letzte = drin.findLast((s) => s.platten.some((p) => p.mount === mount));
    return {
      mount,
      punkte,
      aktuell: letzte?.platten.find((p) => p.mount === mount)?.prozent ?? null,
      aenderung: erster && neu && punkte.length > 1 ? neu.wert - erster.wert : null,
    };
  });
};

/** An hour of a series of Z-1106: of a server or of an installation's Linux user */
type Stunde = { stunde: number };

/**
 * One value's series in the range up to `jetzt` (Z-1106): the highest reading of each step, as
 * for the disks, and the newest hour's value; hours without the value add nothing
 */
export const lastReihe = <S extends Stunde>(
  stunden: readonly S[],
  wert: (s: S) => number | null,
  bereich: Bereich,
  jetzt: number,
): { punkte: Punkt[]; aktuell: number | null } => {
  const von = jetzt - BEREICH_MS[bereich];
  const schritt = SCHRITT_MS[bereich];
  const fach = new Map<number, number>();
  let aktuell: number | null = null;
  for (const s of stunden) {
    const w = wert(s);
    if (w === null || s.stunde + STUNDE_MS <= von || s.stunde > jetzt) continue;
    const n = Math.max(0, Math.floor((s.stunde - von) / schritt));
    fach.set(n, Math.max(fach.get(n) ?? 0, w));
    aktuell = w;
  }
  const punkte = [...fach.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, w]) => ({ zeitpunkt: Math.min(von + (n + 0.5) * schritt, jetzt), wert: w }));
  return { punkte, aktuell };
};

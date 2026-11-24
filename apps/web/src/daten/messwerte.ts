import type { TagesVerfuegbarkeit } from "@steuerzentrale/planung";
import type { Ton } from "../teile/diagramme.tsx";
import { type BackupLauf, laufBytes } from "./backups.ts";

/*
 * The tab "Messwerte" of an app as data (docs/aussen.md, docs/backups.md): only what the Zentrale
 * measures. The availability per day from the checks from outside (Z-704): a bar per day, green at
 * 100 %, yellow below, red below 99 %, grey without a check; the share over all days, and how many
 * days had red checks with how many minutes (the hourly counts know red minutes, not when an outage
 * began and ended, so single outages cannot be counted). The size of each nightly backup (Z-601,
 * Z-804) in a range.
 */

/** Below this share a day is red: more than 14 minutes without an answer */
export const ROT_UNTER = 0.99;

export const tagTon = (t: Pick<TagesVerfuegbarkeit, "anteil">): Ton => {
  if (t.anteil === null) return "leer";
  if (t.anteil >= 1) return "ok";
  return t.anteil < ROT_UNTER ? "danger" : "warn";
};

const anteilVon = (gemessen: number, rot: number) =>
  gemessen === 0 ? null : (gemessen - rot) / gemessen;

/** Green of all measured minutes of the days; null without any */
export const gesamtAnteil = (tage: TagesVerfuegbarkeit[]): number | null =>
  anteilVon(
    tage.reduce((s, t) => s + t.gemessen, 0),
    tage.reduce((s, t) => s + t.rot, 0),
  );

/** How many days had red minutes, and how many minutes in all */
export const ausfaelle = (tage: TagesVerfuegbarkeit[]): { tage: number; minuten: number } => ({
  tage: tage.filter((t) => t.rot > 0).length,
  minuten: tage.reduce((s, t) => s + t.rot, 0),
});

export type MonatsAnteil = { jahr: number; monat: number; anteil: number | null };

/** The months the days fall in, newest first, each with the share of its days shown */
export const monateDerTage = (tage: TagesVerfuegbarkeit[]): MonatsAnteil[] => {
  const schluessel = [...new Set(tage.map((t) => t.jahr * 12 + t.monat - 1))].sort((a, b) => b - a);
  return schluessel.map((k) => {
    const drin = tage.filter((t) => t.jahr * 12 + t.monat - 1 === k);
    return {
      jahr: Math.floor(k / 12),
      monat: (k % 12) + 1,
      anteil: anteilVon(
        drin.reduce((s, t) => s + t.gemessen, 0),
        drin.reduce((s, t) => s + t.rot, 0),
      ),
    };
  });
};

export type Bereich = "24h" | "7t" | "30t";

export const BEREICH_MS: Record<Bereich, number> = {
  "24h": 86_400_000,
  "7t": 7 * 86_400_000,
  "30t": 30 * 86_400_000,
};

const STUFEN = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * The top of a chart's scale, which starts at 0: the next round number (1, 1.5, 2, 2.5, 3, 4, 5, 6
 * or 8 times a power of ten) at least a tenth above the largest value, so that one does not touch
 * the top and the label names a round number
 */
export const skalaMax = (wert: number): number => {
  const ziel = Math.max(wert, 1) * 1.1;
  const zehner = 10 ** Math.floor(Math.log10(ziel));
  return (STUFEN.find((s) => s * zehner >= ziel) ?? 10) * zehner;
};

/** The size of each successful run with sizes in the range up to `jetzt`, oldest first */
export const backupGroessen = (
  laeufe: BackupLauf[],
  bereich: Bereich,
  jetzt: number,
): { zeitpunkt: number; wert: number }[] =>
  laeufe
    .filter((l) => l.zeitpunkt > jetzt - BEREICH_MS[bereich] && l.zeitpunkt <= jetzt)
    .map((l) => ({ zeitpunkt: l.zeitpunkt, wert: laufBytes(l) }))
    .filter((p): p is { zeitpunkt: number; wert: number } => p.wert !== null)
    .sort((a, b) => a.zeitpunkt - b.zeitpunkt);

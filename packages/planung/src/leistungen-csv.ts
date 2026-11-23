import { csvText } from "./csv.ts";
import type { KundenLeistung } from "./leistungen.ts";

/*
 * The services of a month as CSV (BAULISTE.md Z-804; docs/plan.md, "Leistungen"), the same for the
 * Zentrale's export and the demo: one record per customer; the column names are fixed, whatever
 * the language of the interface, so a program reading the file keeps working; storage in bytes and
 * time in minutes as whole numbers; the availability in percent with two decimals, cut, not
 * rounded, so 99.899 % never reads as the SLA's 99.90 %; empty where nothing was measured or known.
 */

/** The services of a month as the Zentrale's API answers them */
export type Leistungen = {
  monat: string;
  kunden: (KundenLeistung & { name: string; kuerzel: string })[];
};

export const LEISTUNGEN_KOPF = [
  "monat",
  "kunde",
  "kuerzel",
  "installationen",
  "apps",
  "speicher_bytes",
  "support_minuten",
  "verfuegbarkeit_prozent",
  "gemessene_minuten",
  "minuten",
] as const;

/** The name the export of a month downloads as */
export const leistungenDatei = (monat: string): string => `leistungen-${monat}.csv`;

const prozent = (anteil: number | null): string | null =>
  // the small step keeps a share like 0.29 (0.28999… in binary) at 29.00
  anteil === null ? null : (Math.floor(anteil * 10_000 + 1e-9) / 100).toFixed(2);

export const leistungenCsv = (l: Leistungen): string =>
  csvText(
    LEISTUNGEN_KOPF,
    l.kunden.map((k) => [
      l.monat,
      k.name,
      k.kuerzel,
      k.installationen.length,
      [...new Set(k.installationen.map((i) => i.app))].sort().join(" "),
      k.speicherBytes,
      k.supportMinuten,
      prozent(k.verfuegbarkeit.anteil),
      k.verfuegbarkeit.gemessen,
      k.verfuegbarkeit.minuten,
    ]),
  );

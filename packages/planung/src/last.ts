import { stundeVon } from "./verfuegbarkeit.ts";

/*
 * CPU, load and memory over time (BAULISTE.md Z-1106; the tab "Auslastung" of a server, "Messwerte"
 * of an app): the agent reports them with its facts every 15 minutes, the Zentrale keeps the facts
 * 30 days. Per UTC hour the highest reading of each value, as for the disks, so a short peak is not
 * averaged away; memory as a share of the server's RAM, and per Linux user in MiB. A value the
 * agent could not read adds nothing.
 */

export type NutzerGemessen = { name: string; cpuProzent: number | null; ramMb: number | null };

export type LastGemessen = {
  cpuProzent: number | null;
  last1: number | null;
  ramBelegtMb: number | null;
  nutzer: NutzerGemessen[];
};

/** One report of the facts: when, the server's RAM, and `last` (absent from an older agent) */
export type LastMessung = { zeitpunkt: number; ramMb: number | null; last: LastGemessen | null };

export type Werte = { cpuProzent: number | null; last1: number | null; ramProzent: number | null };

export type LastStunde = Werte & {
  stunde: number;
  nutzer: Record<string, { cpuProzent: number | null; ramMb: number | null }>;
};

const max = (a: number | null | undefined, b: number | null): number | null =>
  b === null ? (a ?? null) : a === null || a === undefined ? b : Math.max(a, b);

const ramProzent = (m: LastMessung): number | null =>
  m.ramMb && m.last?.ramBelegtMb !== null && m.last?.ramBelegtMb !== undefined
    ? Math.round((m.last.ramBelegtMb / m.ramMb) * 1000) / 10
    : null;

const hinzu = (alt: LastStunde, m: LastMessung): LastStunde => {
  const nutzer = { ...alt.nutzer };
  for (const n of m.last?.nutzer ?? []) {
    const vorher = nutzer[n.name];
    nutzer[n.name] = {
      cpuProzent: max(vorher?.cpuProzent, n.cpuProzent),
      ramMb: max(vorher?.ramMb, n.ramMb),
    };
  }
  return {
    stunde: alt.stunde,
    cpuProzent: max(alt.cpuProzent, m.last?.cpuProzent ?? null),
    last1: max(alt.last1, m.last?.last1 ?? null),
    ramProzent: max(alt.ramProzent, ramProzent(m)),
    nutzer,
  };
};

/** The highest readings per hour, the hours oldest first; a report without `last` adds nothing */
export const lastProStunde = (messungen: readonly LastMessung[]): LastStunde[] => {
  const stunden = new Map<number, LastStunde>();
  for (const m of messungen) {
    if (!m.last) continue;
    const stunde = stundeVon(m.zeitpunkt);
    const alt = stunden.get(stunde) ?? {
      stunde,
      cpuProzent: null,
      last1: null,
      ramProzent: null,
      nutzer: {},
    };
    stunden.set(stunde, hinzu(alt, m));
  }
  return [...stunden.values()].sort((a, b) => a.stunde - b.stunde);
};

/** Over 90 % of the RAM in use is yellow, over 95 % red (Z-702's way of a check) */
export const RAM_WARNUNG_PROZENT = 90;
export const RAM_STOERUNG_PROZENT = 95;

/** The newest reading's memory in use against the RAM; unknown without both */
export const arbeitsspeicherPruefen = (ramMb: number | null, belegtMb: number | null) => {
  if (!ramMb || belegtMb === null)
    return { pruefung: "arbeitsspeicher" as const, ergebnis: "unbekannt" as const, prozent: null };
  const prozent = Math.round((belegtMb / ramMb) * 1000) / 10;
  const ergebnis =
    belegtMb * 100 > RAM_STOERUNG_PROZENT * ramMb
      ? ("rot" as const)
      : belegtMb * 100 > RAM_WARNUNG_PROZENT * ramMb
        ? ("gelb" as const)
        : ("gruen" as const);
  return { pruefung: "arbeitsspeicher" as const, ergebnis, prozent };
};

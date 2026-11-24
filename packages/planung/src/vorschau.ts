import { type Sperrzeit, sperrzeitAm } from "./fenster.ts";
import { instantVon, ortszeit, tagesbeginn } from "./zeit.ts";

/*
 * The overview's look ahead and back (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): which freeze
 * windows begin within the next days, and since when "von selbst erledigt" counts. Both in Berlin
 * days, so a change of the clocks moves neither midnight nor the evening by an hour.
 */

/** How far "Als Nächstes" looks ahead for what the Zentrale does by itself */
export const VORSCHAU_TAGE = 7;

/** How far it looks ahead for deadlines that run out by themselves: certificates, contracts */
export const FRIST_TAGE = 30;

/** "Seit gestern Abend": from this hour in Berlin on the day before */
export const ABEND_STUNDE = 18;

/** A freeze window that begins at `beginn` (midnight in Berlin) and ends at `ende` (the midnight after its last day) */
export type SperrzeitBeginn = { grund: string; beginn: number; ende: number };

/** The midnight after the last day of the freeze window that holds `beginn` */
const endeAb = (sperrzeit: Sperrzeit, beginn: number): number => {
  let tag = beginn;
  for (let i = 0; i <= 31 && sperrzeitAm([sperrzeit], tag); i++) tag = tagesbeginn(tag, 1);
  return tag;
};

/**
 * The freeze windows that begin after `ab` and no later than `bis`: a Berlin day inside one whose
 * day before is not. One that began already is not "coming", it is on.
 */
export const sperrzeitBeginne = (
  sperrzeiten: readonly Sperrzeit[],
  ab: number,
  bis: number,
): SperrzeitBeginn[] =>
  sperrzeiten.flatMap((s) => {
    const beginne: SperrzeitBeginn[] = [];
    for (let tag = tagesbeginn(ab, 1); tag <= bis; tag = tagesbeginn(tag, 1)) {
      const drin = sperrzeitAm([s], tag) !== undefined;
      const davor = sperrzeitAm([s], tagesbeginn(tag, -1)) !== undefined;
      if (drin && !davor) beginne.push({ grund: s.grund, beginn: tag, ende: endeAb(s, tag) });
    }
    return beginne;
  });

/** 18:00 in Berlin on the day before `jetzt`: where "since yesterday evening" begins */
export const gesternAbend = (jetzt: number): number => {
  const gestern = ortszeit(tagesbeginn(jetzt, -1));
  return instantVon(gestern.jahr, gestern.monat, gestern.tag, ABEND_STUNDE, 0);
};

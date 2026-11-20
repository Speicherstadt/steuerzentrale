import { instantVon, ortszeit, tagesbeginn } from "./zeit.ts";

/**
 * A freeze window of an app (manifest `sperrzeiten`): the days `von` to `bis` of every month,
 * inclusive, as Berlin calendar days. `bis` before `von` crosses the month's end ("28-03"); a day
 * a month lacks (the 31st in April) simply does not occur.
 */
export type Sperrzeit = { monatlich: string; grund: string };

/**
 * A maintenance window of a server: on the given weekdays (0 Sunday) from `von` to `bis`, Berlin
 * time "HH:MM"; `bis` at or before `von` ends on the next day (over midnight)
 */
export type Wartungsfenster = { tage: number[]; von: string; bis: string };

const TAG_MS = 24 * 3600_000;
/** How far ahead a slot is searched: longer than any freeze window plus a week */
export const SUCHTAGE = 62;

const tage = (sperrzeit: Sperrzeit): [number, number] => {
  const [von, bis] = sperrzeit.monatlich.split("-").map(Number);
  return [von ?? 0, bis ?? 0];
};

/** The freeze window `instant` falls into, if any */
export const sperrzeitAm = (
  sperrzeiten: readonly Sperrzeit[],
  instant: number,
): Sperrzeit | undefined => {
  const { tag } = ortszeit(instant);
  return sperrzeiten.find((s) => {
    const [von, bis] = tage(s);
    return von <= bis ? tag >= von && tag <= bis : tag >= von || tag <= bis;
  });
};

/** The first instant at or after `ab` outside every freeze window, or undefined within SUCHTAGE days */
export const nachSperrzeit = (
  sperrzeiten: readonly Sperrzeit[],
  ab: number,
): number | undefined => {
  let kandidat = ab;
  for (let i = 0; i <= SUCHTAGE; i++) {
    if (!sperrzeitAm(sperrzeiten, kandidat)) return kandidat;
    kandidat = tagesbeginn(kandidat, 1);
  }
  return undefined;
};

const uhrzeit = (text: string): [number, number] => {
  const [h, m] = text.split(":").map(Number);
  return [h ?? 0, m ?? 0];
};

/** The window instances [start, end) that begin on the Berlin day starting at `tag` */
const fensterAmTag = (fenster: readonly Wartungsfenster[], tag: number): [number, number][] => {
  const o = ortszeit(tag);
  return fenster
    .filter((f) => f.tage.includes(o.wochentag))
    .map((f): [number, number] => {
      const [vh, vm] = uhrzeit(f.von);
      const [bh, bm] = uhrzeit(f.bis);
      const ueberMitternacht = bh * 60 + bm <= vh * 60 + vm;
      return [
        instantVon(o.jahr, o.monat, o.tag, vh, vm),
        instantVon(o.jahr, o.monat, o.tag + (ueberMitternacht ? 1 : 0), bh, bm),
      ];
    })
    .filter(([start, ende]) => ende > start);
};

/**
 * The first instant at or after `ab` inside a maintenance window and outside every freeze window,
 * or undefined if there is none within SUCHTAGE days. The start counts: an update beginning at
 * 23:00 on the 6th is outside a freeze window from the 7th.
 */
export const naechsterTermin = (
  fenster: readonly Wartungsfenster[],
  sperrzeiten: readonly Sperrzeit[],
  ab: number,
): number | undefined => {
  // The day before too: a window over midnight that began yesterday may still be open
  for (let i = -1; i <= SUCHTAGE; i++) {
    const tag = tagesbeginn(ab, i);
    const termine = fensterAmTag(fenster, tag)
      .filter(([, ende]) => ende > ab)
      .flatMap(([start, ende]) => {
        // Within one window a freeze window can only begin at a midnight inside it
        const kandidaten = [
          Math.max(start, ab),
          ...[tagesbeginn(start, 1)].filter((t) => t > ab && t < ende),
        ];
        return kandidaten.filter((k) => k < ende && !sperrzeitAm(sperrzeiten, k)).slice(0, 1);
      })
      .sort((a, b) => a - b);
    if (termine[0] !== undefined) return termine[0];
  }
  return undefined;
};

export { TAG_MS };

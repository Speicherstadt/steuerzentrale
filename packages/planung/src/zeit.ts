/*
 * Local time in Europe/Berlin without a time zone library: the runtime's Intl data gives the offset
 * of an instant; a local wall time is found from it. Instants are UTC milliseconds (CLAUDE.md,
 * "Times"). A wall time that does not exist (the hour skipped in spring) moves forward by the
 * length of the gap, as Temporal's "compatible" does; one that exists twice (the hour repeated in
 * autumn) is its first occurrence.
 */
export const ZEITZONE = "Europe/Berlin";

const format = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZEITZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const WOCHENTAGE = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A wall time in Berlin; `wochentag` 0 is Sunday */
export type Ortszeit = {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
  wochentag: number;
};

const teileVon = (instant: number): Record<string, string> =>
  Object.fromEntries(format.formatToParts(new Date(instant)).map((t) => [t.type, t.value]));

export const ortszeit = (instant: number): Ortszeit => {
  const teile = teileVon(instant);
  return {
    jahr: Number(teile.year),
    monat: Number(teile.month),
    tag: Number(teile.day),
    stunde: Number(teile.hour),
    minute: Number(teile.minute),
    wochentag: WOCHENTAGE.indexOf(teile.weekday ?? ""),
  };
};

/** How far Berlin is ahead of UTC at `instant`, in milliseconds */
const versatz = (instant: number): number => {
  const t = teileVon(instant);
  const wand = Date.UTC(
    Number(t.year),
    Number(t.month) - 1,
    Number(t.day),
    Number(t.hour),
    Number(t.minute),
    Number(t.second),
  );
  return wand - Math.floor(instant / 1000) * 1000;
};

/** The instant of a Berlin wall time (month 1–12; a day past the month's end rolls over) */
export const instantVon = (
  jahr: number,
  monat: number,
  tag: number,
  stunde: number,
  minute: number,
): number => {
  const wand = Date.UTC(jahr, monat - 1, tag, stunde, minute);
  // The earlier of the two offsets around the wall time gives the first occurrence
  const kandidaten = [
    wand - versatz(wand - 3 * 3600_000),
    wand - versatz(wand + 3 * 3600_000),
  ].sort((a, b) => a - b);
  for (const kandidat of kandidaten) if (kandidat + versatz(kandidat) === wand) return kandidat;
  // In the gap: the earlier offset, which lands as far after the gap as the wall time was in it
  return Math.max(...kandidaten);
};

/** Midnight in Berlin at the start of the day `tage` days after the day of `instant` */
export const tagesbeginn = (instant: number, tage = 0): number => {
  const o = ortszeit(instant);
  return instantVon(o.jahr, o.monat, o.tag + tage, 0, 0);
};

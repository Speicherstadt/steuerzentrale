/** The demo's "now": Friday, 20 November 2026, 10:42 in Berlin (as in design/mockup/) */
const tag = (datum: string) => datum.split("-").map(Number) as [number, number, number];

const berlinTeile = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** How far Berlin's wall clock is ahead of UTC at an instant, in milliseconds */
const versatz = (instant: number) => {
  const teile = Object.fromEntries(
    berlinTeile.formatToParts(instant).map((teil) => [teil.type, teil.value]),
  );
  const wand = Date.UTC(
    Number(teile.year),
    Number(teile.month) - 1,
    Number(teile.day),
    Number(teile.hour),
    Number(teile.minute),
  );
  return wand - instant;
};

/** The instant of a Berlin wall-clock time, so the fixtures read like the mockup */
export const berlin = (datum: string, uhrzeit = "00:00"): number => {
  const [jahr, monat, t] = tag(datum);
  const [stunde, minute] = uhrzeit.split(":").map(Number) as [number, number];
  const geraten = Date.UTC(jahr, monat - 1, t, stunde, minute);
  // The offset at the guess can differ from the one at the result within hours of a DST change:
  // take it again at the first result
  return geraten - versatz(geraten - versatz(geraten));
};

export const JETZT = berlin("2026-11-20", "10:42");

/** Today at a Berlin time, and the days before */
export const heute = (uhrzeit: string) => berlin("2026-11-20", uhrzeit);
export const gestern = (uhrzeit: string) => berlin("2026-11-19", uhrzeit);
export const minutenVorher = (minuten: number) => JETZT - minuten * 60_000;
export const sekundenVorher = (sekunden: number) => JETZT - sekunden * 1000;

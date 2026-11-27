import { getLocale, m } from "@steuerzentrale/ui";

/*
 * Instants are UTC milliseconds and shown in Europe/Berlin (docs/entwicklung.md); dates as
 * TT.MM.JJJJ in every language (DESIGN.md, "Sprache"). formatToParts keeps the shape independent of
 * the browser's locale data.
 */

const ZONE = "Europe/Berlin";

const teileFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

type Teile = { jahr: string; monat: string; tag: string; stunde: string; minute: string };

export const berlinTeile = (instant: number): Teile => {
  const teile = Object.fromEntries(
    teileFormat.formatToParts(instant).map((teil) => [teil.type, teil.value]),
  );
  return {
    jahr: teile.year ?? "",
    monat: teile.month ?? "",
    tag: teile.day ?? "",
    stunde: teile.hour ?? "",
    minute: teile.minute ?? "",
  };
};

/** How far Berlin's wall clock is ahead of UTC at an instant, in milliseconds */
const versatz = (instant: number) => {
  const t = berlinTeile(instant);
  const wand = Date.UTC(
    Number(t.jahr),
    Number(t.monat) - 1,
    Number(t.tag),
    Number(t.stunde),
    Number(t.minute),
  );
  return wand - instant;
};

/** The instant of a Berlin wall-clock time on a day "JJJJ-MM-TT"; 00:00 is the start of the day */
export const berlin = (tag: string, uhrzeit = "00:00"): number => {
  const [jahr, monat, t] = tag.split("-").map(Number) as [number, number, number];
  const [stunde, minute] = uhrzeit.split(":").map(Number) as [number, number];
  const geraten = Date.UTC(jahr, monat - 1, t, stunde, minute);
  // The offset at the guess can differ from the one at the result within hours of a DST change:
  // take it again at the first result
  return geraten - versatz(geraten - versatz(geraten));
};

/** The day of an instant in Berlin as "JJJJ-MM-TT", the value of a date field */
export const isoTag = (instant: number) => {
  const t = berlinTeile(instant);
  return `${t.jahr}-${t.monat}-${t.tag}`;
};

/** The start of the Berlin day `tage` calendar days after the day of `instant` */
export const tageSpaeter = (instant: number, tage: number) => {
  const t = berlinTeile(instant);
  const tag = new Date(Date.UTC(Number(t.jahr), Number(t.monat) - 1, Number(t.tag) + tage));
  return berlin(tag.toISOString().slice(0, 10));
};

/** The day of the month in Berlin, for monthly freeze windows */
export const berlinTag = (instant: number) => Number(berlinTeile(instant).tag);

/** TT.MM.JJJJ */
export const datum = (instant: number) => {
  const t = berlinTeile(instant);
  return `${t.tag}.${t.monat}.${t.jahr}`;
};

/** HH:MM */
export const uhrzeit = (instant: number) => {
  const t = berlinTeile(instant);
  return `${t.stunde}:${t.minute}`;
};

const TAG = 86_400_000;

/** Whole calendar days between two instants in Berlin, positive when `instant` lies ahead */
const kalendertage = (instant: number, jetzt: number) => {
  const mitternacht = (x: number) => {
    const t = berlinTeile(x);
    return Date.UTC(Number(t.jahr), Number(t.monat) - 1, Number(t.tag));
  };
  return Math.round((mitternacht(instant) - mitternacht(jetzt)) / TAG);
};

/** "10:36" today, "gestern 17:12" or "morgen 03:30", else "18.11.2026 14:05" */
export const zeitpunkt = (instant: number, jetzt: number): string => {
  const zeit = uhrzeit(instant);
  const abstand = kalendertage(instant, jetzt);
  if (abstand === 0) return zeit;
  if (abstand === -1) return m.zeit_gestern({ zeit });
  if (abstand === 1) return m.zeit_morgen({ zeit });
  return `${datum(instant)} ${zeit}`;
};

/** How long ago, coarse: "vor 12 s", "vor 6 Min.", "vor 3 h", "vor 2 Tagen" */
export const vor = (instant: number, jetzt: number): string => {
  const sekunden = Math.max(0, Math.round((jetzt - instant) / 1000));
  if (sekunden < 60) return m.zeit_vor_sekunden({ n: sekunden });
  if (sekunden < 3600) return m.zeit_vor_minuten({ n: Math.floor(sekunden / 60) });
  if (sekunden < 86_400) return m.zeit_vor_stunden({ n: Math.floor(sekunden / 3600) });
  return m.zeit_vor_tagen({ n: Math.floor(sekunden / 86_400) });
};

const _zwei = (n: number) => String(n).padStart(2, "0");

/** "November 2026" in the interface language */
export const monatName = (monat: string) => {
  const [jahr, mm] = monat.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(getLocale() === "de" ? "de-DE" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(jahr, mm - 1, 15));
};

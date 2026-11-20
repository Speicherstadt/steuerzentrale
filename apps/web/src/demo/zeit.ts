import { berlin } from "../format/zeit.ts";

/** The demo's "now": Friday, 20 November 2026, 10:42 in Berlin (as in design/mockup/) */

/** The instant of a Berlin wall-clock time, so the fixtures read like the mockup */
export { berlin };

export const JETZT = berlin("2026-11-20", "10:42");

/** Today at a Berlin time, and the days before */
export const heute = (uhrzeit: string) => berlin("2026-11-20", uhrzeit);
export const gestern = (uhrzeit: string) => berlin("2026-11-19", uhrzeit);
export const minutenVorher = (minuten: number) => JETZT - minuten * 60_000;
export const sekundenVorher = (sekunden: number) => JETZT - sekunden * 1000;

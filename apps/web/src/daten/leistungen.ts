import type { Leistungen } from "@steuerzentrale/planung";
import { type Antwort, api } from "../anmeldung/api.ts";
import { demoLeistungen } from "../demo/leistungen.ts";

/*
 * The services of each customer in a month (BAULISTE.md Z-804; docs/plan.md, "Leistungen"), as the
 * Zentrale's API answers (apps/zentrale, routes/leistungen.ts), and where the month's CSV comes
 * from. Signed in the API, else the demo in memory.
 */

export type LeistungenQuelle = {
  imMonat: (monat: string) => Promise<Antwort<Leistungen>>;
  /** Where the link "CSV" downloads the month from */
  csvAdresse: (monat: string) => string;
};

export const apiLeistungen: LeistungenQuelle = {
  imMonat: (monat) => api<Leistungen>(`/api/v1/leistungen?monat=${encodeURIComponent(monat)}`),
  csvAdresse: (monat) => `/api/v1/leistungen?monat=${encodeURIComponent(monat)}&format=csv`,
};

let quelle: LeistungenQuelle = demoLeistungen();

export const leistungenQuelle = (): LeistungenQuelle => quelle;

export const leistungenQuelleEinsetzen = (neu: LeistungenQuelle): void => {
  quelle = neu;
};

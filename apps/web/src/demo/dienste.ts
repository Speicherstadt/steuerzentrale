import type { Dienst } from "../daten/dienste.ts";
import { JETZT, minutenVorher } from "./zeit.ts";

/*
 * The observed services of the demo operator (BAULISTE.md Z-1101): the operator's own wiki behind
 * Cloudflare, green; the status page of a customer, red outside since 10:35 for a certificate that
 * ran out. Their availability is that of November up to the demo's "now", every minute measured.
 */

const MONAT = { jahr: 2026, monat: 11 };
// 1 November 00:00 in Berlin up to 10:42 on the 20th
const MINUTEN = 19 * 24 * 60 + 10 * 60 + 42 + 60;

const verfuegbarkeit = (rot: number) => ({
  ...MONAT,
  minuten: MINUTEN,
  gemessen: MINUTEN,
  rot,
  anteil: (MINUTEN - rot) / MINUTEN,
});

export const dienste: Dienst[] = [
  {
    id: "dienst-wiki",
    name: "Wiki",
    adresse: "https://wiki.beispiel-hosting.de",
    host: "wiki.beispiel-hosting.de",
    pfad: "/",
    kundeId: null,
    angelegtAm: minutenVorher(60 * 24 * 40),
    aussen: {
      zustand: "gruen",
      grund: { code: "erreichbar", werte: { status: "200", ms: "112" } },
      seit: minutenVorher(60 * 24 * 12),
      geprueftAm: JETZT - 20_000,
    },
    verfuegbarkeit: verfuegbarkeit(14),
  },
  {
    id: "dienst-status",
    name: "Statusseite Praxis Weber",
    adresse: "https://status.praxis-weber.de",
    host: "status.praxis-weber.de",
    pfad: "/health",
    kundeId: "praxis-weber",
    angelegtAm: minutenVorher(60 * 24 * 90),
    aussen: {
      zustand: "rot",
      grund: { code: "zertifikat", werte: { fehler: "CERT_HAS_EXPIRED" } },
      seit: minutenVorher(7),
      geprueftAm: JETZT - 20_000,
    },
    verfuegbarkeit: verfuegbarkeit(7),
  },
];

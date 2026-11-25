import type { Dienst } from "../daten/dienste.ts";
import { JETZT, minutenVorher } from "./zeit.ts";

/*
 * The observed services of the demo operator (BAULISTE.md Z-1101): the operator's own wiki behind
 * Cloudflare, green; the status page of a customer, red outside since 10:35 for a certificate that
 * ran out; the Kontext on the server that is only observed, whose units its agent reads (Z-1103),
 * green outside and inside. Their availability is that of November up to the demo's "now", every
 * minute measured.
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
    innen: null,
    innenStand: null,
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
    innen: null,
    innenStand: null,
  },
  {
    id: "dienst-kontext",
    name: "Kontext",
    adresse: "https://kontext.beispiel-hosting.de",
    host: "kontext.beispiel-hosting.de",
    pfad: "/health",
    kundeId: null,
    angelegtAm: minutenVorher(60 * 24 * 20),
    aussen: {
      zustand: "gruen",
      grund: { code: "erreichbar", werte: { status: "200", ms: "64" } },
      seit: minutenVorher(60 * 24 * 20),
      geprueftAm: JETZT - 20_000,
    },
    verfuegbarkeit: verfuegbarkeit(0),
    innen: {
      serverId: "bestand",
      nutzer: "kontext",
      units: ["kontext.service", "kontext-redis.service"],
      health: { art: "http", port: 3000, pfad: "/health" },
    },
    innenStand: {
      bewertung: "gruen",
      grund: { code: "health", werte: { text: "HTTP 200" } },
      seit: minutenVorher(60 * 24 * 20),
      gemeldetAm: JETZT - 12_000,
    },
  },
];

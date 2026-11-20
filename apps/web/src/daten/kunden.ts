import { type Antwort, api } from "../anmeldung/api.ts";
import { kunden } from "../demo/kunden.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import type { Kunde } from "./typen.ts";

/*
 * Where the customer pages read and write (BAULISTE.md Z-801): the Zentrale's API once someone is
 * signed in (main.tsx puts it in), else the demo fixtures, kept in memory, for `bun run dev:demo`
 * and the component tests. Errors come back as values (src/anmeldung/api.ts).
 */

/** What a person enters about a customer; an optional field left out is empty */
export type Stammdaten = {
  name: string;
  kontakt: { name: string; email: string; telefon?: string };
  notiz?: string;
};

export type KundeNeu = Stammdaten & { vertrag: { sla: "basis"; beginn: number } };
export type KundeAenderung = Stammdaten & { beginn: number };

export type KundenQuelle = {
  liste: () => Promise<Antwort<Kunde[]>>;
  kunde: (id: string) => Promise<Antwort<Kunde>>;
  anlegen: (neu: KundeNeu, grund: string) => Promise<Antwort<Kunde>>;
  aendern: (id: string, daten: KundeAenderung, grund: string) => Promise<Antwort<Kunde>>;
  /** Sets the day the contract ends: the customer gave notice */
  kuendigen: (id: string, ende: number, grund: string) => Promise<Antwort<Kunde>>;
  /** Takes the notice back: the contract runs on */
  zuruecknehmen: (id: string, grund: string) => Promise<Antwort<Kunde>>;
};

const pfad = (id: string) => `/api/v1/kunden/${encodeURIComponent(id)}`;

export const apiKunden: KundenQuelle = {
  liste: async () => {
    const antwort = await api<{ kunden: Kunde[] }>("/api/v1/kunden");
    return antwort.ok ? { ...antwort, daten: antwort.daten.kunden } : antwort;
  },
  kunde: (id) => api<Kunde>(pfad(id)),
  anlegen: (neu, grund) => api<Kunde>("/api/v1/kunden", { body: { ...neu, grund } }),
  aendern: (id, daten, grund) => api<Kunde>(pfad(id), { method: "PUT", body: { ...daten, grund } }),
  kuendigen: (id, ende, grund) =>
    api<Kunde>(`${pfad(id)}/kuendigung`, { method: "PUT", body: { ende, grund } }),
  zuruecknehmen: (id, grund) =>
    api<Kunde>(`${pfad(id)}/kuendigung`, { method: "DELETE", body: { grund } }),
};

let quelle: KundenQuelle = demoKunden(kunden, Date.now);

export const kundenQuelle = (): KundenQuelle => quelle;

export const kundenQuelleEinsetzen = (neu: KundenQuelle): void => {
  quelle = neu;
};

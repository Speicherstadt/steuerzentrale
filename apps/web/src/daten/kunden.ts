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
  /** Left out: a new customer gets one from its name, a changed one keeps its own (Z-407) */
  kuerzel?: string;
};

export type KundeNeu = Stammdaten & { vertrag: { beginn: number } };
export type KundeAenderung = Stammdaten & { beginn: number };

export type KundenQuelle = {
  liste: () => Promise<Antwort<Kunde[]>>;
  kunde: (id: string) => Promise<Antwort<Kunde>>;
  anlegen: (neu: KundeNeu) => Promise<Antwort<Kunde>>;
  aendern: (id: string, daten: KundeAenderung) => Promise<Antwort<Kunde>>;
  /** Sets the day the contract ends: the customer gave notice */
  kuendigen: (id: string, ende: number) => Promise<Antwort<Kunde>>;
  /** Takes the notice back: the contract runs on */
  zuruecknehmen: (id: string) => Promise<Antwort<Kunde>>;
  /** Marks the customer as our own or takes it back (Z-501); only the owner */
  intern: (id: string, intern: boolean) => Promise<Antwort<Kunde>>;
};

const pfad = (id: string) => `/api/v1/kunden/${encodeURIComponent(id)}`;

export const apiKunden: KundenQuelle = {
  liste: async () => {
    const antwort = await api<{ kunden: Kunde[] }>("/api/v1/kunden");
    return antwort.ok ? { ...antwort, daten: antwort.daten.kunden } : antwort;
  },
  kunde: (id) => api<Kunde>(pfad(id)),
  anlegen: (neu) => api<Kunde>("/api/v1/kunden", { body: neu }),
  aendern: (id, daten) => api<Kunde>(pfad(id), { method: "PUT", body: daten }),
  kuendigen: (id, ende) => api<Kunde>(`${pfad(id)}/kuendigung`, { method: "PUT", body: { ende } }),
  zuruecknehmen: (id) => api<Kunde>(`${pfad(id)}/kuendigung`, { method: "DELETE", body: {} }),
  intern: (id, intern) => api<Kunde>(`${pfad(id)}/intern`, { method: "PUT", body: { intern } }),
};

let quelle: KundenQuelle = demoKunden(kunden, Date.now);

export const kundenQuelle = (): KundenQuelle => quelle;

export const kundenQuelleEinsetzen = (neu: KundenQuelle): void => {
  quelle = neu;
};

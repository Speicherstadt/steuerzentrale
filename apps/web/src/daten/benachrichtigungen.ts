import { type Antwort, api } from "../anmeldung/api.ts";
import { demoBenachrichtigungen } from "../demo/benachrichtigungen.ts";

/*
 * The operator's notifications (BAULISTE.md Z-703; docs/benachrichtigungen.md), for the settings'
 * tab "Benachrichtigungen": mail server, quiet hours, recipients and the newest deliveries, as
 * GET /api/v1/benachrichtigungen answers. The SMTP password and a webhook's URL and key go only to
 * the Zentrale and never come back. Signed in the API, else the demo in memory.
 */

export type Schwere = "info" | "warn" | "fehler";
export type Sicherheit = "tls" | "starttls" | "keine";

export type Smtp = {
  host: string;
  port: number;
  sicherheit: Sicherheit;
  benutzer: string | null;
  absender: string;
  passwortGesetzt: boolean;
};

export type Ruhezeit = { von: string; bis: string };

export type Empfaenger = {
  empfaengerId: string;
  art: "mail" | "webhook";
  /** The address, or a webhook's origin only */
  anzeige: string;
  abSchwere: Schwere;
  angelegtAm: number;
};

export type Zustellung = {
  zustellungId: string;
  ereignisText: string | null;
  empfaenger: string | null;
  schwere: string;
  zustand: "wartet" | "zugestellt" | "aufgegeben";
  versuche: number;
  fehler: string | null;
  angelegtAm: number;
  faelligAm: number;
  erledigtAm: number | null;
};

export type Benachrichtigungen = {
  smtp: Smtp | null;
  ruhezeit: Ruhezeit | null;
  empfaenger: Empfaenger[];
  zustellungen: Zustellung[];
};

/** What the form sends; a password left out keeps the one set */
export type SmtpAenderung = Omit<Smtp, "passwortGesetzt"> & { passwort?: string };

export type NeuerEmpfaenger =
  | { art: "mail"; adresse: string; abSchwere: Schwere }
  | { art: "webhook"; url: string; schluessel: string; abSchwere: Schwere };

export type BenachrichtigungsQuelle = {
  lesen: () => Promise<Antwort<Benachrichtigungen>>;
  setzen: (
    neu: { smtp: SmtpAenderung | null; ruhezeit: Ruhezeit | null },
    grund: string,
  ) => Promise<Antwort<Benachrichtigungen>>;
  anlegen: (neu: NeuerEmpfaenger, grund: string) => Promise<Antwort<Empfaenger>>;
  entfernen: (empfaengerId: string, grund: string) => Promise<Antwort<null>>;
  testen: (empfaengerId: string) => Promise<Antwort<{ ok: true }>>;
};

const PFAD = "/api/v1/benachrichtigungen";

export const apiBenachrichtigungen: BenachrichtigungsQuelle = {
  lesen: () => api<Benachrichtigungen>(PFAD),
  setzen: (neu, grund) => api<Benachrichtigungen>(PFAD, { method: "PUT", body: { ...neu, grund } }),
  anlegen: (neu, grund) => api<Empfaenger>(`${PFAD}/empfaenger`, { body: { ...neu, grund } }),
  entfernen: (id, grund) =>
    api<null>(`${PFAD}/empfaenger/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: { grund },
    }),
  testen: (id) =>
    api<{ ok: true }>(`${PFAD}/empfaenger/${encodeURIComponent(id)}/test`, { body: {} }),
};

let quelle: BenachrichtigungsQuelle = demoBenachrichtigungen();

export const benachrichtigungsQuelle = (): BenachrichtigungsQuelle => quelle;

export const benachrichtigungsQuelleEinsetzen = (neu: BenachrichtigungsQuelle): void => {
  quelle = neu;
};

/**
 * A signing key for a new webhook, made in the browser: 32 random bytes as base64url (43
 * characters). The interface shows it once, before saving; the Zentrale never sends it back
 */
export const neuerSchluessel = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

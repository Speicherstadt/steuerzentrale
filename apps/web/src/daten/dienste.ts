import type { AussenGrund, AussenStand, MonatsVerfuegbarkeit } from "@steuerzentrale/planung";
import { m } from "@steuerzentrale/ui";
import { type Antwort, api } from "../anmeldung/api.ts";
import { demoDienste } from "../demo/dienste-quelle.ts";
import { aussenGrundText } from "./aussen.ts";
import { grundText, type HealthGrund } from "./bewertung.ts";
import type { Health } from "./typen.ts";

/*
 * Observed services (BAULISTE.md Z-1101): a service the Zentrale did not install, checked from
 * outside every minute like an installation, with no version, backup, update or actions. As the
 * Zentrale's API answers (apps/zentrale, routes/dienste.ts) once someone is signed in, else the demo
 * in memory. Every role reads, only the owner makes, changes and removes them. On a server that is
 * only observed the agent may read its units inside (Z-1103), rated like an installation's.
 */

/** The check on 127.0.0.1 the agent makes for an observed service */
export type InnenHealth =
  | { art: "http"; port: number; pfad: string }
  | { art: "tcp"; port: number }
  | { art: "keine" };

/** What the agent reads inside (Z-1103) */
export type DienstInnen = {
  serverId: string;
  /** null: units of the system */
  nutzer: string | null;
  units: string[];
  health: InnenHealth;
};

/** The rating inside now, as the Zentrale gives it */
export type InnenStand = {
  bewertung: Health;
  grund: HealthGrund;
  seit: number | null;
  gemeldetAm: number | null;
};

export type Dienst = {
  id: string;
  name: string;
  /** `https://<host>` */
  adresse: string;
  host: string;
  pfad: string;
  kundeId: string | null;
  angelegtAm: number;
  /** The state from outside now, null before the first check */
  aussen: AussenStand | null;
  /** The current month up to now */
  verfuegbarkeit: MonatsVerfuegbarkeit;
  /** What the agent reads inside, null when only checked from outside */
  innen: DienstInnen | null;
  /** The rating inside now; null without `innen` */
  innenStand: InnenStand | null;
};

/** What the owner enters for the inside: a port with a path is an HTTP check, without one TCP */
export type InnenAngaben = {
  serverId: string;
  nutzer: string | null;
  units: string[];
  port: number | null;
  pfad: string | null;
};

/** What the owner enters; the Zentrale takes the address only as `https://<host>` */
export type DienstAngaben = {
  name: string;
  adresse: string;
  pfad: string;
  kundeId: string | null;
  innen: InnenAngaben | null;
};

/** The units as typed: separated by spaces or commas, each once */
export const unitsAus = (text: string): string[] => [
  ...new Set(text.split(/[\s,]+/).filter((u) => u !== "")),
];

/** The check as the owner enters it again */
export const innenAngaben = (i: DienstInnen): InnenAngaben => ({
  serverId: i.serverId,
  nutzer: i.nutzer,
  units: i.units,
  port: i.health.art === "keine" ? null : i.health.port,
  pfad: i.health.art === "http" ? i.health.pfad : null,
});

/** The check of the entered values, as the Zentrale stores it */
export const innenHealth = (a: InnenAngaben): InnenHealth =>
  a.port === null
    ? { art: "keine" }
    : a.pfad === null
      ? { art: "tcp", port: a.port }
      : { art: "http", port: a.port, pfad: a.pfad };

export type DiensteQuelle = {
  liste: () => Promise<Antwort<Dienst[]>>;
  anlegen: (angaben: DienstAngaben) => Promise<Antwort<Dienst>>;
  aendern: (id: string, angaben: DienstAngaben) => Promise<Antwort<Dienst>>;
  entfernen: (id: string) => Promise<Antwort<null>>;
};

const pfad = (id: string) => `/api/v1/dienste/${encodeURIComponent(id)}`;

export const apiDienste: DiensteQuelle = {
  liste: async () => {
    const a = await api<{ dienste: Dienst[] }>("/api/v1/dienste");
    return a.ok ? { ...a, daten: a.daten.dienste } : a;
  },
  anlegen: (angaben) => api<Dienst>("/api/v1/dienste", { body: angaben }),
  aendern: (id, angaben) => api<Dienst>(pfad(id), { method: "PUT", body: angaben }),
  entfernen: (id) => api<null>(pfad(id), { method: "DELETE" }),
};

let quelle: DiensteQuelle = demoDienste();

export const diensteQuelle = (): DiensteQuelle => quelle;

export const diensteQuelleEinsetzen = (neu: DiensteQuelle): void => {
  quelle = neu;
};

/**
 * How a service stands, outside and, where the agent reads it, inside together: red, yellow,
 * unknown (also before the first check) or green when every side measured is
 */
export type DienstStufe = "rot" | "gelb" | "unbekannt" | "gut";

export const dienstStufe = (d: Dienst): DienstStufe => {
  const innen = d.innen ? (d.innenStand?.bewertung ?? "unbekannt") : "gruen";
  if (d.aussen?.zustand === "rot" || innen === "rot") return "rot";
  if (innen === "gelb") return "gelb";
  return d.aussen?.zustand === "gruen" && innen === "gruen" ? "gut" : "unbekannt";
};

const RANG: Record<DienstStufe, number> = { rot: 0, gelb: 1, unbekannt: 2, gut: 3 };

/** What needs attention first, else by name as the Zentrale lists them */
export const diensteGeordnet = (dienste: Dienst[]): Dienst[] =>
  dienste
    .map((d, n) => ({ d, n }))
    .sort((a, b) => RANG[dienstStufe(a.d)] - RANG[dienstStufe(b.d)] || a.n - b.n)
    .map(({ d }) => d);

/** The reason in words; no Pforte stands in front of an observed service, so it is the connection */
export const dienstGrundText = (g: AussenGrund): string =>
  g.code === "pforte" ? m.dienst_verbindung({ fehler: g.werte.fehler ?? "" }) : aussenGrundText(g);

/** The state from outside in the words of the column */
export const dienstZustandText = (d: Dienst): string => {
  if (!d.aussen) return m.dienst_noch_nicht_geprueft();
  if (d.aussen.zustand === "gruen") return m.dienst_erreichbar();
  return dienstGrundText(d.aussen.grund);
};

/** The state inside in words, undefined when the agent reads nothing */
export const dienstInnenText = (d: Dienst): string | undefined => {
  if (!d.innen) return undefined;
  const stand = d.innenStand;
  if (!stand) return m.dienst_innen_text({ text: m.bewertung_grund_noch_keine_meldung() });
  if (stand.bewertung === "gruen") return m.dienst_innen_gruen();
  return m.dienst_innen_text({ text: grundText(stand.grund) });
};

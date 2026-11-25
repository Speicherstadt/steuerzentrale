import type { AussenGrund, AussenStand, MonatsVerfuegbarkeit } from "@steuerzentrale/planung";
import { m } from "@steuerzentrale/ui";
import { type Antwort, api } from "../anmeldung/api.ts";
import { demoDienste } from "../demo/dienste-quelle.ts";
import { aussenGrundText } from "./aussen.ts";

/*
 * Observed services (BAULISTE.md Z-1101): a service the Zentrale did not install, checked from
 * outside every minute like an installation, with no version, backup, update or actions. As the
 * Zentrale's API answers (apps/zentrale, routes/dienste.ts) once someone is signed in, else the demo
 * in memory. Every role reads, only the owner makes, changes and removes them.
 */

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
};

/** What the owner enters; the Zentrale takes the address only as `https://<host>` */
export type DienstAngaben = { name: string; adresse: string; pfad: string; kundeId: string | null };

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

/** How a service stands from outside: red, unknown (also before the first check) or green */
export type DienstStufe = "rot" | "unbekannt" | "gut";

export const dienstStufe = (d: Dienst): DienstStufe => {
  if (d.aussen?.zustand === "rot") return "rot";
  return d.aussen?.zustand === "gruen" ? "gut" : "unbekannt";
};

const RANG: Record<DienstStufe, number> = { rot: 0, unbekannt: 1, gut: 2 };

/** What needs attention first, else by name as the Zentrale lists them */
export const diensteGeordnet = (dienste: Dienst[]): Dienst[] =>
  dienste
    .map((d, n) => ({ d, n }))
    .sort((a, b) => RANG[dienstStufe(a.d)] - RANG[dienstStufe(b.d)] || a.n - b.n)
    .map(({ d }) => d);

/** The reason in words; no Pforte stands in front of an observed service, so it is the connection */
export const dienstGrundText = (g: AussenGrund): string =>
  g.code === "pforte" ? m.dienst_verbindung({ fehler: g.werte.fehler ?? "" }) : aussenGrundText(g);

/** The state in the words of the column */
export const dienstZustandText = (d: Dienst): string => {
  if (!d.aussen) return m.dienst_noch_nicht_geprueft();
  if (d.aussen.zustand === "gruen") return m.dienst_erreichbar();
  return dienstGrundText(d.aussen.grund);
};

import { type Antwort, api } from "../anmeldung/api.ts";
import { demoSupport } from "../demo/support-quelle.ts";
import { bestand } from "./quelle.ts";
import type { Zugang } from "./typen.ts";

/*
 * Support accesses (BAULISTE.md Z-802; docs/plan.md, "Support-Zugang"): the list, starting one for
 * oneself on an installation with a reason and a duration, ending one early. Signed in the
 * Zentrale's API (main.tsx puts it in), else the demo's accesses in memory.
 */

export type ZugangsFilter = { kundeId?: string; installationId?: string };

/** The durations the dialog offers, in minutes; the Zentrale takes 15 to 240 */
export const DAUERN = [60, 120, 240] as const;
export const DAUER_VORGABE = 120;

export type SupportQuelle = {
  liste: (filter?: ZugangsFilter) => Promise<Antwort<Zugang[]>>;
  starten: (
    installationId: string,
    dauerMinuten: number,
    grund: string,
  ) => Promise<Antwort<Zugang>>;
  beenden: (zugangId: string) => Promise<Antwort<Zugang>>;
};

const abfrage = (filter: ZugangsFilter = {}): string => {
  const teile = Object.entries(filter).filter(([, wert]) => wert !== undefined);
  return teile.length === 0 ? "" : `?${new URLSearchParams(teile as [string, string][])}`;
};

export const apiSupport: SupportQuelle = {
  liste: async (filter) => {
    const antwort = await api<{ zugaenge: Zugang[] }>(`/api/v1/support-zugaenge${abfrage(filter)}`);
    return antwort.ok ? { ...antwort, daten: antwort.daten.zugaenge } : antwort;
  },
  starten: (installationId, dauerMinuten, grund) =>
    api<Zugang>("/api/v1/support-zugaenge", { body: { installationId, dauerMinuten, grund } }),
  beenden: (zugangId) =>
    api<Zugang>(`/api/v1/support-zugaenge/${encodeURIComponent(zugangId)}/beenden`, { body: {} }),
};

let quelle: SupportQuelle = demoSupport(bestand().zugaenge, () => bestand().jetzt, {
  name: bestand().konto.name,
  kundeVon: (id) => bestand().installationen.find((i) => i.id === id)?.kunde,
});

export const supportQuelle = (): SupportQuelle => quelle;

export const supportQuelleEinsetzen = (neu: SupportQuelle): void => {
  quelle = neu;
};

/** The signed-in member's running access to the installation, if any */
export const eigenerZugang = (zugaenge: Zugang[], installationId: string): Zugang | undefined =>
  zugaenge.find((z) => z.eigen && z.aktiv && z.installationId === installationId);

import type { EinstellungsFeld } from "@steuerzentrale/manifest";
import { type Antwort, api } from "../anmeldung/api.ts";
import { demoEinstellungenQuelle } from "../demo/einstellungen.ts";
import { demo } from "../demo/index.ts";
import type { Einstellungswert } from "./installationen.ts";
import { installationenQuelle } from "./installationen.ts";

/*
 * The operator's values of each app (BAULISTE.md Z-404; docs/plan.md, "Werte des Betreibers
 * schreiben"), for the settings' area "Apps": the apps the operator has installations of, each with
 * the form of its newest manifest as the Zentrale answers it (GET /api/v1/apps/:app/einstellungen).
 * A secret comes back only as set. Signed in the API, else the demo fixtures in memory.
 */

/** As GET /api/v1/apps/:app/einstellungen answers */
export type BetreiberEinstellungen = {
  app: string;
  version: string;
  felder: EinstellungsFeld[];
  werte: Record<string, Einstellungswert>;
  gesetzt: string[];
};

export type EinstellungenQuelle = {
  /** Every app of the operator's installations that has a form, by name */
  apps: () => Promise<Antwort<BetreiberEinstellungen[]>>;
  aendern: (
    app: string,
    werte: Record<string, Einstellungswert>,
    grund: string,
  ) => Promise<Antwort<BetreiberEinstellungen>>;
};

const pfad = (app: string) => `/api/v1/apps/${encodeURIComponent(app)}/einstellungen`;

export const apiEinstellungen: EinstellungenQuelle = {
  apps: async () => {
    const liste = await installationenQuelle().liste();
    if (!liste.ok) return liste;
    const namen = [...new Set(liste.daten.map((i) => i.app))].sort();
    const antworten = await Promise.all(namen.map((a) => api<BetreiberEinstellungen>(pfad(a))));
    const fehler = antworten.find((a) => !a.ok && a.status !== 404);
    if (fehler && !fehler.ok) return fehler;
    return {
      ok: true,
      status: 200,
      daten: antworten.flatMap((a) => (a.ok ? [a.daten] : [])),
    };
  },
  aendern: (app, werte, grund) =>
    api<BetreiberEinstellungen>(pfad(app), { method: "PUT", body: { werte, grund } }),
};

let quelle: EinstellungenQuelle = demoEinstellungenQuelle(demo);

export const einstellungenQuelle = (): EinstellungenQuelle => quelle;

export const einstellungenQuelleEinsetzen = (neu: EinstellungenQuelle): void => {
  quelle = neu;
};

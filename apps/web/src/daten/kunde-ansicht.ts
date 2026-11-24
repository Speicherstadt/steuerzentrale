import { letzteMonate, type Monat, type MonatsVerfuegbarkeit } from "@steuerzentrale/planung";
import type { AppZeile, Stufe } from "./apps-liste.ts";
import { ZIEL_PROZENT } from "./aussen.ts";

/*
 * The page of one customer as data (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): its
 * apps in one sentence for the head, and the availability of each app per month for the tab
 * "Leistungen", from the months GET /api/v1/installationen/:id/aussen answers (Z-704), with the
 * customer's whole as the share of all its measured minutes. Nothing that is not measured: a month
 * without a check stays empty.
 */

export type KundeStand =
  | { art: "keine" }
  | { art: "laufen"; apps: number }
  | { art: "unterwegs"; apps: number; unterwegs: number }
  | { art: "braucht"; apps: number; braucht: number };

const BRAUCHT: Stufe[] = ["rot", "gelb", "unbekannt"];

/** Its apps in one: none, all well, some need someone, or some are being set up or updated */
export const kundeStand = (zeilen: AppZeile[]): KundeStand => {
  const apps = zeilen.length;
  if (apps === 0) return { art: "keine" };
  const braucht = zeilen.filter((z) => BRAUCHT.includes(z.stufe)).length;
  if (braucht > 0) return { art: "braucht", apps, braucht };
  const unterwegs = zeilen.filter((z) => z.stufe === "unterwegs").length;
  return unterwegs > 0 ? { art: "unterwegs", apps, unterwegs } : { art: "laufen", apps };
};

export type Zelle = { anteil: number | null; unterZiel: boolean };

export type VerfuegbarkeitsTabelle = {
  /** The months, oldest first, the current one last */
  monate: Monat[];
  zeilen: { id: string; zellen: Zelle[] }[];
  /** All its apps together: the share of all their measured minutes of each month */
  gesamt: Zelle[];
};

const zelle = (gemessen: number, rot: number): Zelle => {
  const anteil = gemessen === 0 ? null : (gemessen - rot) / gemessen;
  return { anteil, unterZiel: anteil !== null && anteil * 100 < ZIEL_PROZENT };
};

const gleich = (a: Monat, b: Monat) => a.jahr === b.jahr && a.monat === b.monat;

/** The last `anzahl` months up to `jetzt` for each app, and all of them together */
export const verfuegbarkeitsTabelle = (
  apps: { id: string; monate: MonatsVerfuegbarkeit[] }[],
  anzahl: number,
  jetzt: number,
): VerfuegbarkeitsTabelle => {
  const monate = letzteMonate(jetzt, anzahl).reverse();
  const werte = (app: (typeof apps)[number], monat: Monat) =>
    app.monate.find((v) => gleich(v, monat)) ?? { gemessen: 0, rot: 0 };
  return {
    monate,
    zeilen: apps.map((app) => ({
      id: app.id,
      zellen: monate.map((monat) => {
        const v = werte(app, monat);
        return zelle(v.gemessen, v.rot);
      }),
    })),
    gesamt: monate.map((monat) => {
      const alle = apps.map((app) => werte(app, monat));
      return zelle(
        alle.reduce((s, v) => s + v.gemessen, 0),
        alle.reduce((s, v) => s + v.rot, 0),
      );
    }),
  };
};

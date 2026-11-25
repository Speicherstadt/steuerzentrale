import type { AppZeile, Stufe } from "./apps-liste.ts";

/*
 * The page of one customer as data (docs/plan.md, "Server und Kunden (Oberfläche 2026-11)"): its
 * apps in one sentence for the head.
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

import { appVon, istGekuendigt, istIntern } from "./ableitungen.ts";
import type { Bestand, Installation, Updateplan } from "./typen.ts";

/*
 * Update waves in stage 1 (BAULISTE.md, Z-502): "intern" (our own installations), then "alle" 24 h
 * after "intern" without a fault. Cancelled installations stay out. The plan itself comes from
 * packages/planung later; this only sorts the installations of a running plan.
 */

export type Welle = "intern" | "alle";
export type WellenZustand = "fertig" | "laeuft" | "wartet" | "leer";

export type WellenStand = {
  welle: Welle;
  installationen: Installation[];
  fertig: number;
  zustand: WellenZustand;
};

export const WELLEN: Welle[] = ["intern", "alle"];

export const welleVon = (b: Bestand, i: Installation): Welle =>
  istIntern(b, i) ? "intern" : "alle";

const zustandVon = (liste: Installation[], fertig: number): WellenZustand => {
  if (liste.length === 0) return "leer";
  if (fertig === liste.length) return "fertig";
  return liste.some((i) => i.updateLaeuft) ? "laeuft" : "wartet";
};

/** Each wave of a plan with its installations and how many reached the version */
export const wellen = (b: Bestand, plan: Updateplan): WellenStand[] =>
  WELLEN.map((welle) => {
    const liste = b.installationen.filter(
      (i) => i.app === plan.app && !istGekuendigt(b, i) && welleVon(b, i) === welle,
    );
    const fertig = liste.filter((i) => i.version === plan.version).length;
    return { welle, installationen: liste, fertig, zustand: zustandVon(liste, fertig) };
  });

/**
 * Apps without health whose installations lag behind: no wave updates them, only a person with a
 * reason (docs/plan.md, "Apps ohne Betreiber-Vertrag"; BAULISTE.md, Z-503)
 */
export const nurVonHand = (b: Bestand) =>
  b.apps
    .filter((a) => "keine" in a.health && a.version !== null)
    .map((app) => ({
      app,
      zurueck: b.installationen.filter(
        (i) => i.app === app.id && i.version !== app.version && !istGekuendigt(b, i),
      ),
    }))
    .filter((x) => x.zurueck.length > 0);

/** Installations on a plan's version among those the plan covers, for the overview */
export const planStand = (b: Bestand, plan: Updateplan) => {
  const alle = wellen(b, plan).flatMap((w) => w.installationen);
  const laufend = wellen(b, plan).find((w) => w.zustand === "laeuft" || w.zustand === "wartet");
  return {
    app: appVon(b, plan.app),
    fertig: alle.filter((i) => i.version === plan.version).length,
    gesamt: alle.length,
    welle: laufend?.welle,
  };
};

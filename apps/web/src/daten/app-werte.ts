import type { BetreiberEinstellungen } from "./einstellungen.ts";
import type { InstallationDerZentrale } from "./installationen.ts";

/*
 * The line beside the app switch of "Werte für Apps" (docs/einstellungen.md): how many
 * installations an app's values apply to, and how many of its values are set. Pure.
 */

/** A value shown counts unless it is an empty text; a secret counts when the Zentrale names it set */
export const werteGesetzt = (
  e: Pick<BetreiberEinstellungen, "felder" | "werte" | "gesetzt">,
): { gesetzt: number; gesamt: number } => ({
  gesetzt: e.felder.filter((f) =>
    f.geheim ? e.gesetzt.includes(f.name) : (e.werte[f.name] ?? "") !== "",
  ).length,
  gesamt: e.felder.length,
});

/** Per app, its installations that are not removed: the operator's values apply to each */
export const installationenJeApp = (
  liste: readonly Pick<InstallationDerZentrale, "app" | "zustand">[],
): Map<string, number> => {
  const zaehlung = new Map<string, number>();
  for (const i of liste)
    if (i.zustand !== "entfernt") zaehlung.set(i.app, (zaehlung.get(i.app) ?? 0) + 1);
  return zaehlung;
};

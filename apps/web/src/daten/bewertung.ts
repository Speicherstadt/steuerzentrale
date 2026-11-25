import { m } from "@steuerzentrale/ui";
import type { Health } from "./typen.ts";

/*
 * The state of an installation as the Zentrale's API reports it (BAULISTE.md Z-403; packages/planung,
 * bewertung.ts): green, yellow, red or unknown with a reason as a code, said here in the interface's
 * language, since when, and the units of the last report.
 */

export type GrundCode =
  | "health"
  | "unit"
  | "keine_units"
  | "nur_units"
  | "keine_meldung"
  | "noch_keine_meldung";

export type HealthGrund = { code: GrundCode; werte: Record<string, string> };

export type UnitStand = { name: string; aktiv: string };

export type HealthDerZentrale = {
  zustand: Health;
  grund: HealthGrund;
  /** Since when the state holds; null before the first report */
  seit: number | null;
  gemeldetAm: number | null;
  units: UnitStand[];
};

/** A change of the state, as the page's history lists it */
export type Verlaufseintrag = { zeitpunkt: number; bewertung: Health; grund: HealthGrund };

export const grundText = (g: HealthGrund): string => {
  switch (g.code) {
    case "health":
      return m.bewertung_grund_health({ text: g.werte.text ?? "" });
    case "unit":
      return m.bewertung_grund_unit({ unit: g.werte.unit ?? "", aktiv: g.werte.aktiv ?? "" });
    case "keine_units":
      return m.bewertung_grund_keine_units();
    case "nur_units":
      return m.bewertung_grund_nur_units();
    case "keine_meldung":
      return m.bewertung_grund_keine_meldung();
    case "noch_keine_meldung":
      return m.bewertung_grund_noch_keine_meldung();
  }
};

/** Whether a unit is fine: active yes, unreadable unknown, anything else no */
export const unitOk = (aktiv: string): boolean | null =>
  aktiv === "active" ? true : aktiv === "unknown" ? null : false;

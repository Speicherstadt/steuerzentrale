import type {
  AussenGrund,
  AussenStand,
  MonatsVerfuegbarkeit,
  Probe,
  TagesVerfuegbarkeit,
} from "@steuerzentrale/planung";
import { m } from "@steuerzentrale/ui";
import { type Antwort, api } from "../anmeldung/api.ts";
import { demoAussen } from "../demo/aussen.ts";

/*
 * The check from outside and the availability of an installation (BAULISTE.md Z-704; docs/plan.md,
 * "Prüfung von außen", "Verfügbarkeit"), as the Zentrale's API answers (apps/zentrale,
 * routes/aussen.ts): the newest check with what each step answered, and the availability of the
 * current month and the twelve before, newest first; and the availability of each of its last days
 * in Berlin, oldest first (routes/aussen.ts, `/verfuegbarkeit`), for the bars of the tab
 * "Messwerte". Signed in the API, else the demo in memory.
 */

export type AussenDerZentrale = AussenStand & { ergebnis: Probe };

export type AussenDerInstallation = {
  aussen: AussenDerZentrale | null;
  verfuegbarkeit: MonatsVerfuegbarkeit[];
};

export type AussenQuelle = {
  derInstallation: (id: string) => Promise<Antwort<AussenDerInstallation>>;
  /** The availability of each of the last `anzahl` days, today included, oldest first */
  tage: (id: string, anzahl: number) => Promise<Antwort<TagesVerfuegbarkeit[]>>;
};

export const apiAussen: AussenQuelle = {
  derInstallation: (id) =>
    api<AussenDerInstallation>(`/api/v1/installationen/${encodeURIComponent(id)}/aussen`),
  tage: async (id, anzahl) => {
    const a = await api<{ tage: TagesVerfuegbarkeit[] }>(
      `/api/v1/installationen/${encodeURIComponent(id)}/verfuegbarkeit?tage=${anzahl}`,
    );
    return a.ok ? { ...a, daten: a.daten.tage } : a;
  },
};

let quelle: AussenQuelle = demoAussen();

export const aussenQuelle = (): AussenQuelle => quelle;

export const aussenQuelleEinsetzen = (neu: AussenQuelle): void => {
  quelle = neu;
};

/** The reason of a check in the interface language, from its code (modules/aussen/text.ts) */
export const aussenGrundText = (g: AussenGrund): string => {
  const w = (name: string) => g.werte[name] ?? "";
  switch (g.code) {
    case "erreichbar":
      return m.aussen_erreichbar({ status: w("status"), ms: w("ms") });
    case "dns":
      return m.aussen_dns({ fehler: w("fehler") });
    case "dns_abweichung":
      return m.aussen_dns_abweichung({ ist: g.werte.ist ?? "", soll: g.werte.soll ?? "" });
    case "zertifikat":
      return m.aussen_zertifikat({ fehler: w("fehler") });
    case "pforte":
      return m.aussen_pforte({ fehler: w("fehler") });
    case "health":
      return m.aussen_health({ status: w("status") });
    case "keine_pruefung":
      return m.aussen_keine_pruefung();
  }
};

/** Green of measured in percent, or undefined without any check */
export const prozentVon = (v: MonatsVerfuegbarkeit): number | undefined =>
  v.anteil === null ? undefined : v.anteil * 100;

/** The mark of availability: 99.9 % (docs/plan.md, "Prüfung von außen (Z-704)") */
export const ZIEL_PROZENT = 99.9;

/** The month as "2026-11", the form the pages name months in */
export const monatSchluessel = (v: Pick<MonatsVerfuegbarkeit, "jahr" | "monat">): string =>
  `${v.jahr}-${String(v.monat).padStart(2, "0")}`;

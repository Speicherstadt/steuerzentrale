/*
 * The rating of an installation (BAULISTE.md Z-403; docs/plan.md, "Bewertung einer Installation",
 * "Störung"): from what the agent reports about its units and its health check, green, yellow, red
 * or unknown, each with a reason. Green means measured and fine, nothing else: without units, with
 * a unit the agent could not read, or without a report for 90 seconds, an installation is unknown.
 */

export type Bewertung = "gruen" | "gelb" | "rot" | "unbekannt";

/** The ActiveState of a systemd unit, "unknown" for one the agent could not read */
export type Aktiv =
  | "active"
  | "reloading"
  | "inactive"
  | "failed"
  | "activating"
  | "deactivating"
  | "maintenance"
  | "refreshing"
  | "unknown";

/** What the agent reports about one installation (packages/protokoll, message `zustand`) */
export type Meldung = {
  units: readonly { name: string; aktiv: Aktiv }[];
  health: { zustand: Bewertung; grund: string };
};

/**
 * Why an installation is rated as it is, as a code with its values, so the interface can say it in
 * every language: `health` with the check's own text, `unit` with a unit and its ActiveState,
 * `keine_units` (none reported), `nur_units` (the manifest has no check), `keine_meldung` (no report
 * for 90 s), `noch_keine_meldung` (never one)
 */
export type GrundCode =
  | "health"
  | "unit"
  | "keine_units"
  | "nur_units"
  | "keine_meldung"
  | "noch_keine_meldung";

export type Grund = { code: GrundCode; werte: Record<string, string> };

export type Ergebnis = { bewertung: Bewertung; grund: Grund };

/** The agent's text is shown, not kept whole: this many characters at most */
export const GRUND_MAX = 500;

/** Without a report for this long an installation is unknown (three reports missed) */
export const MELDUNG_FRIST_MS = 90_000;

/** Red for this long, continuously, is a fault (docs/plan.md, "Störung") */
export const STOERUNG_NACH_MS = 5 * 60_000;

const health = (text: string): Grund => ({
  code: "health",
  werte: { text: text.slice(0, GRUND_MAX) },
});

const unit = (u: { name: string; aktiv: Aktiv }): Grund => ({
  code: "unit",
  werte: { unit: u.name.slice(0, GRUND_MAX), aktiv: u.aktiv },
});

/**
 * Rates one report. `mitHealth` is whether the installation's manifest has a check: for `keine` the
 * agent reports health unknown ("keine Prüfung"), and the units alone decide
 */
export const installationBewerten = (m: Meldung, mitHealth: boolean): Ergebnis => {
  if (m.health.zustand === "rot") return { bewertung: "rot", grund: health(m.health.grund) };
  const nichtAktiv = m.units.find((u) => u.aktiv !== "active" && u.aktiv !== "unknown");
  if (nichtAktiv) return { bewertung: "gelb", grund: unit(nichtAktiv) };
  const unbekannt = m.units.find((u) => u.aktiv === "unknown");
  if (unbekannt) return { bewertung: "unbekannt", grund: unit(unbekannt) };
  if (m.units.length === 0)
    return { bewertung: "unbekannt", grund: { code: "keine_units", werte: {} } };
  if (!mitHealth) return { bewertung: "gruen", grund: { code: "nur_units", werte: {} } };
  if (m.health.zustand === "gruen" || m.health.zustand === "gelb")
    return { bewertung: m.health.zustand, grund: health(m.health.grund) };
  return { bewertung: "unbekannt", grund: health(m.health.grund) };
};

/** The current rating of an installation: since when it holds and when the last report came */
export type Bewertungsstand = Ergebnis & { seit: number; gemeldetAm: number };

/**
 * The rating after a report: `seit` stays while the rating does (the reason is the newest), a
 * change starts it anew and is a row in the history (`wechsel`)
 */
export const bewertungFortschreiben = (
  alt: Bewertungsstand | null,
  neu: Ergebnis,
  jetzt: number,
): { stand: Bewertungsstand; wechsel: boolean } => {
  const wechsel = alt === null || alt.bewertung !== neu.bewertung;
  return { stand: { ...neu, seit: wechsel ? jetzt : alt.seit, gemeldetAm: jetzt }, wechsel };
};

export type BewertungJetzt =
  | Bewertungsstand
  | { bewertung: "unbekannt"; grund: Grund; seit: null; gemeldetAm: null };

/**
 * The rating as it stands at `jetzt`: unknown without a report for 90 seconds, since the moment the
 * report was due; without any report unknown with no `seit`
 */
export const bewertungJetzt = (stand: Bewertungsstand | null, jetzt: number): BewertungJetzt =>
  stand === null
    ? {
        bewertung: "unbekannt",
        grund: { code: "noch_keine_meldung", werte: {} },
        seit: null,
        gemeldetAm: null,
      }
    : nachFrist(stand, jetzt);

/** A stored rating as it stands at `jetzt`: unknown once no report came for 90 seconds */
export const nachFrist = (stand: Bewertungsstand, jetzt: number): Bewertungsstand => {
  const faellig = stand.gemeldetAm + MELDUNG_FRIST_MS;
  if (stand.bewertung === "unbekannt" || jetzt < faellig) return stand;
  return {
    bewertung: "unbekannt",
    grund: { code: "keine_meldung", werte: {} },
    seit: faellig,
    gemeldetAm: stand.gemeldetAm,
  };
};

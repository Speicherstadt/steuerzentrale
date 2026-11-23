/*
 * The states of a job and the steps between them (BAULISTE.md Z-305; docs/plan.md, "Aufträge"),
 * a pure function shared by Zentrale and tests. A job waits for its predecessors (`wartend`), is
 * ready once all of them succeeded (`bereit`), goes to its server's agent (`zugestellt`), which
 * acknowledges it (`bestaetigt`), runs it (`laeuft`) and reports its result. A job whose predecessor
 * failed or was cancelled is cancelled itself (`abgebrochen`).
 */

export const AUFTRAG_ZUSTAENDE = [
  "wartend",
  "bereit",
  "zugestellt",
  "bestaetigt",
  "laeuft",
  "erfolgreich",
  "gescheitert",
  "abgebrochen",
] as const;
export type AuftragZustand = (typeof AUFTRAG_ZUSTAENDE)[number];

/** The states a job never leaves */
export const ENDZUSTAENDE: ReadonlySet<AuftragZustand> = new Set([
  "erfolgreich",
  "gescheitert",
  "abgebrochen",
]);

/** The states in which a job is the agent's: sent again whenever its agent connects */
export const BEIM_AGENTEN: ReadonlySet<AuftragZustand> = new Set([
  "zugestellt",
  "bestaetigt",
  "laeuft",
]);

export type AuftragEreignis =
  /** Every predecessor succeeded */
  | { art: "vorgaenger_erfolgreich" }
  /** A predecessor failed or was cancelled */
  | { art: "vorgaenger_gescheitert" }
  /** The Zentrale sent it to the agent */
  | { art: "zugestellt" }
  /** The Zentrale cancels it before its agent acknowledged it (a reboot past its time, Z-701) */
  | { art: "abbrechen" }
  | { art: "bestaetigt" }
  | { art: "fortschritt" }
  | { art: "ergebnis"; ok: boolean };

/** The new state; `geaendert: false` for a message that repeats what is known (sent twice) */
export type Uebergang =
  | { ok: true; zustand: AuftragZustand; geaendert: boolean }
  | { ok: false; grund: string };

const nach = (von: AuftragZustand, zu: AuftragZustand): Uebergang => ({
  ok: true,
  zustand: zu,
  geaendert: von !== zu,
});

const ungueltig = (von: AuftragZustand, e: AuftragEreignis): Uebergang => ({
  ok: false,
  grund: `${e.art} is not possible for a job that is ${von}`,
});

/** Which states an event leads from, and where to */
const SCHRITTE: Record<
  Exclude<AuftragEreignis["art"], "ergebnis">,
  Partial<Record<AuftragZustand, AuftragZustand>>
> = {
  vorgaenger_erfolgreich: { wartend: "bereit" },
  vorgaenger_gescheitert: { wartend: "abgebrochen", abgebrochen: "abgebrochen" },
  // sent again after a reconnect: the job stays where the agent took it
  zugestellt: {
    bereit: "zugestellt",
    zugestellt: "zugestellt",
    bestaetigt: "bestaetigt",
    laeuft: "laeuft",
  },
  // an agent acknowledges a job again when it gets it again, also after its result
  bestaetigt: {
    zugestellt: "bestaetigt",
    bestaetigt: "bestaetigt",
    laeuft: "laeuft",
    erfolgreich: "erfolgreich",
    gescheitert: "gescheitert",
  },
  fortschritt: { zugestellt: "laeuft", bestaetigt: "laeuft", laeuft: "laeuft" },
  // once the agent acknowledged it, the job is the agent's: only its result ends it
  abbrechen: { bereit: "abgebrochen", zugestellt: "abgebrochen" },
};

const ergebnis = (von: AuftragZustand, ok: boolean, e: AuftragEreignis): Uebergang => {
  const ziel: AuftragZustand = ok ? "erfolgreich" : "gescheitert";
  if (BEIM_AGENTEN.has(von) || von === ziel) return nach(von, ziel);
  return ungueltig(von, e);
};

export const uebergang = (von: AuftragZustand, e: AuftragEreignis): Uebergang => {
  if (e.art === "ergebnis") return ergebnis(von, e.ok, e);
  const zu = SCHRITTE[e.art][von];
  return zu === undefined ? ungueltig(von, e) : nach(von, zu);
};

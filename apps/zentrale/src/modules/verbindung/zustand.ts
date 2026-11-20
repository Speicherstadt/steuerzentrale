import { HEARTBEAT_MS } from "@steuerzentrale/protokoll";

/*
 * The state of a server's agent as the interface shows it (BAULISTE.md Z-303): "verbunden",
 * "seit x min still", "getrennt". A pure function of whether the agent's connection is open (since
 * when) and its last heartbeat, so list, page and API agree.
 */

/** Silent: two heartbeats and a half missed, so one late heartbeat does not count */
export const STILL_AB_MS = 2.5 * HEARTBEAT_MS;

export type VerbindungsZustand =
  | { zustand: "verbunden"; letzterHeartbeat: number | null }
  | { zustand: "still"; letzterHeartbeat: number | null; stillSeitMin: number }
  | { zustand: "getrennt"; letzterHeartbeat: number | null };

export type Verbindungsdaten = {
  /** When the open connection began; undefined without one */
  verbundenSeit: number | undefined;
  letzterHeartbeat: number | undefined;
};

export const verbindungsZustand = (daten: Verbindungsdaten, jetzt: number): VerbindungsZustand => {
  const letzterHeartbeat = daten.letzterHeartbeat ?? null;
  if (daten.verbundenSeit === undefined) return { zustand: "getrennt", letzterHeartbeat };
  // a connection without a heartbeat yet is as silent as the time since it opened
  const still = jetzt - Math.max(daten.verbundenSeit, daten.letzterHeartbeat ?? 0);
  if (still < STILL_AB_MS) return { zustand: "verbunden", letzterHeartbeat };
  return { zustand: "still", letzterHeartbeat, stillSeitMin: Math.floor(still / 60_000) };
};

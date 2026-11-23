import { naechsterTermin, TAG_MS, type Wartungsfenster } from "./fenster.ts";
import { versionVergleichen } from "./versionen.ts";

/*
 * When the Zentrale updates the agent of a server (BAULISTE.md Z-504; docs/plan.md, "Update des
 * Agenten"): to the version it serves, when the agent reports an older one, only in the server's
 * maintenance window, only while the agent is connected and no other job is open on the server (the
 * restart of the agent ends a running one, and an update of an installation counts too: at most one
 * update per server), and a version that was tried and ended without the agent on it again only a
 * day later. Freeze windows of the apps do not count: the agent's restart leaves the apps running.
 * Pure: the Zentrale's loop asks it for each server.
 */

/** A failed or undone attempt at a version is tried again after this long, in the next window */
export const VERSUCH_PAUSE_MS = TAG_MS;

export type AgentServer = {
  /** What the agent reported in `hallo`; null before it ever connected */
  agentVersion: string | null;
  architektur: string | null;
  wartungsfenster: Wartungsfenster;
  verbunden: boolean;
  /** Jobs on the server that have not ended, an update of the agent among them */
  offeneAuftraege: number;
  /** When the last update of the agent to this version ended, if one did */
  letzterVersuchAm?: number;
};

export type AgentWartegrund =
  | "aktuell"
  | "unbekannt"
  | "getrennt"
  | "auftraege"
  | "versucht"
  | "fenster";

export type AgentUpdateEntscheid =
  | { art: "jetzt" }
  | { art: "warten"; grund: AgentWartegrund; ab?: number };

const warten = (grund: AgentWartegrund, ab?: number): AgentUpdateEntscheid =>
  ab === undefined ? { art: "warten", grund } : { art: "warten", grund, ab };

export const agentUpdatePruefen = (
  s: AgentServer,
  version: string,
  jetzt: number,
): AgentUpdateEntscheid => {
  if (s.agentVersion === null || s.architektur === null) return warten("unbekannt");
  if (versionVergleichen(s.agentVersion, version) >= 0) return warten("aktuell");
  if (!s.verbunden) return warten("getrennt");
  if (s.offeneAuftraege > 0) return warten("auftraege");
  if (s.letzterVersuchAm !== undefined && jetzt - s.letzterVersuchAm < VERSUCH_PAUSE_MS)
    return warten("versucht", s.letzterVersuchAm + VERSUCH_PAUSE_MS);
  const termin = naechsterTermin([s.wartungsfenster], [], jetzt);
  return termin === jetzt ? { art: "jetzt" } : warten("fenster", termin);
};

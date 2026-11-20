// Messages between the Zentrale and the agent, shared by both so they cannot drift apart
// (docs/plan.md, "Technologie").

export {
  AELTESTE_VERSION,
  AUFWERTUNGEN,
  type Aufwertung,
  type Gelesen,
  PROTOKOLL_VERSION,
  schreiben,
  vomAgentenLesen,
  vonDerZentraleLesen,
} from "./lesen.ts";
export {
  Auftrag,
  Bestaetigt,
  Ergebnis,
  Fakten,
  Fortschritt,
  Hallo,
  Heartbeat,
  LogAuszug,
  type NachrichtVomAgenten,
  type NachrichtVonDerZentrale,
  SshAnmeldung,
  VomAgenten,
  VonDerZentrale,
  Willkommen,
  Zustand,
} from "./nachrichten.ts";

/** The version of the Steuerzentrale, the same for Zentrale and agent; kept equal to package.json (test) */
export const VERSION = "0.0.0";

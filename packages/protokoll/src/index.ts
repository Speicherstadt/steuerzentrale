// Messages between the Zentrale and the agent, shared by both so they cannot drift apart
// (docs/plan.md, "Technologie").

export {
  AUFTRAG_ZUSTAENDE,
  type AuftragEreignis,
  type AuftragZustand,
  BEIM_AGENTEN,
  ENDZUSTAENDE,
  type Uebergang,
  uebergang,
} from "./auftraege.ts";
export { BEITRITT_PFAD, BeitrittAnfrage, BeitrittAntwort } from "./beitritt.ts";
export {
  AELTESTE_VERSION,
  AUFWERTUNGEN,
  type Aufwertung,
  type Gelesen,
  MAX_NACHRICHT_BYTES,
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
  TRENNUNG,
  VomAgenten,
  VonDerZentrale,
  Willkommen,
  Zertifikat,
  ZertifikatAnfrage,
  Zustand,
} from "./nachrichten.ts";

export { FAKTEN_MS, HEARTBEAT_MS, ROTIEREN_VOR_MS, VERBINDUNG_PFAD } from "./verbindung.ts";

/** The version of the Steuerzentrale, the same for Zentrale and agent; kept equal to package.json (test) */
export const VERSION = "0.0.0";

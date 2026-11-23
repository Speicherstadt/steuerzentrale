// The rating of an installation, update waves, freeze windows, maintenance windows and server
// checks as pure functions (docs/plan.md, "Projektstruktur").

export {
  type AgentServer,
  type AgentUpdateEntscheid,
  type AgentWartegrund,
  agentUpdatePruefen,
  VERSUCH_PAUSE_MS,
} from "./agent.ts";
export {
  type Aktiv,
  type Bewertung,
  type BewertungJetzt,
  type Bewertungsstand,
  bewertungFortschreiben,
  bewertungJetzt,
  type Ergebnis,
  GRUND_MAX,
  type Grund,
  type GrundCode,
  installationBewerten,
  MELDUNG_FRIST_MS,
  type Meldung,
  nachFrist,
  STOERUNG_NACH_MS,
  stoerungPruefen,
} from "./bewertung.ts";

export {
  nachSperrzeit,
  naechsterTermin,
  type Sperrzeit,
  sperrzeitAm,
  type Wartungsfenster,
} from "./fenster.ts";
export {
  type AngeboteneVersion,
  angeboteneVersionen,
  istVorabversion,
  type ManifestVersion,
  tagAlsVersion,
  versionAngeboten,
  versionVergleichen,
} from "./versionen.ts";
export {
  type Planeintrag,
  type PlanInstallation,
  type PlanUpdate,
  type Sperrfreigabe,
  updatePlan,
  WARTEZEIT_MS,
  type Wartegrund,
  type Welle,
  type Wellenstand,
} from "./wellen.ts";
export { instantVon, type Ortszeit, ortszeit, tagesbeginn, ZEITZONE } from "./zeit.ts";

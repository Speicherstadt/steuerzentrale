// Update waves, freeze windows, maintenance windows and server checks as pure functions
// (docs/plan.md, "Projektstruktur").

export {
  nachSperrzeit,
  naechsterTermin,
  type Sperrzeit,
  sperrzeitAm,
  type Wartungsfenster,
} from "./fenster.ts";
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

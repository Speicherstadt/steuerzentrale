import {
  nachSperrzeit,
  naechsterTermin,
  type Sperrzeit,
  sperrzeitAm,
  TAG_MS,
  type Wartungsfenster,
} from "./fenster.ts";

/*
 * The update plan of Stufe 1 (docs/plan.md, "Ablauf: Update", "Welle intern"): two waves, "intern"
 * (our own installations) and "alle", which starts 24 h after "intern" finished without a failure.
 * Without an installation of our own, "alle" waits for a release by hand. An urgent update runs at
 * once through both waves; a freeze window is passed over only by the owner, with a reason. A
 * failure stops every wave. Pure: all state comes in, the plan goes out.
 */

export type Welle = "intern" | "alle";

export type PlanInstallation = {
  id: string;
  /** One of our own installations, updated in the wave "intern" */
  intern: boolean;
  /** False for an app without health (`health: keine`): updated only by hand */
  automatisch: boolean;
  sperrzeiten: readonly Sperrzeit[];
  wartungsfenster: readonly Wartungsfenster[];
};

export type PlanUpdate = { version: string; dringend: boolean; vorabversion: boolean };

export type Wellenstand = {
  /** When the last installation of "intern" was updated and healthy */
  internFertigAm?: number;
  /** When an update of this version failed or was rolled back: every wave stops */
  stoerungAm?: number;
  /** When "alle" was released by hand because there is no installation of our own */
  freigabeAlleAm?: number;
};

/** The owner's release of one installation from its freeze window (docs/plan.md, "Updates") */
export type Sperrfreigabe = { installationId: string; rolle: string; grund: string };

export type Wartegrund =
  | "angehalten"
  | "nur_von_hand"
  | "vorabversion"
  | "intern_laeuft"
  | "freigabe_noetig"
  | "kein_termin";

export type Planeintrag = {
  installationId: string;
  welle: Welle;
  ergebnis:
    | { art: "termin"; ab: number; sperrzeitUebergangen: boolean }
    | { art: "wartet"; grund: Wartegrund };
};

export const WARTEZEIT_MS = TAG_MS;

const gueltig = (f: Sperrfreigabe): boolean => f.rolle === "inhaber" && f.grund.trim() !== "";

/** When the wave "alle" may start, or why it waits */
const startAlle = (
  installationen: readonly PlanInstallation[],
  update: PlanUpdate,
  stand: Wellenstand,
  jetzt: number,
): number | Wartegrund => {
  if (update.vorabversion) return "vorabversion";
  if (update.dringend) return jetzt;
  if (!installationen.some((i) => i.intern))
    return stand.freigabeAlleAm === undefined ? "freigabe_noetig" : stand.freigabeAlleAm;
  if (stand.internFertigAm === undefined) return "intern_laeuft";
  return stand.internFertigAm + WARTEZEIT_MS;
};

const termin = (
  i: PlanInstallation,
  update: PlanUpdate,
  ab: number,
  freigabe: boolean,
): Planeintrag["ergebnis"] => {
  const sperrzeiten = freigabe ? [] : i.sperrzeiten;
  const uebergangen = freigabe && i.sperrzeiten.length > 0;
  if (update.dringend) {
    const sofort = nachSperrzeit(sperrzeiten, ab);
    if (sofort === undefined) return { art: "wartet", grund: "kein_termin" };
    return {
      art: "termin",
      ab: sofort,
      sperrzeitUebergangen: uebergangen && sperrzeitAm(i.sperrzeiten, ab) !== undefined,
    };
  }
  const naechster = naechsterTermin(i.wartungsfenster, sperrzeiten, ab);
  if (naechster === undefined) return { art: "wartet", grund: "kein_termin" };
  return {
    art: "termin",
    ab: naechster,
    sperrzeitUebergangen: uebergangen && sperrzeitAm(i.sperrzeiten, naechster) !== undefined,
  };
};

/** The plan for every installation that still runs an older version of the app */
export const updatePlan = (
  installationen: readonly PlanInstallation[],
  update: PlanUpdate,
  stand: Wellenstand,
  freigaben: readonly Sperrfreigabe[],
  jetzt: number,
): Planeintrag[] => {
  const alle = startAlle(installationen, update, stand, jetzt);
  return installationen.map((i): Planeintrag => {
    const welle: Welle = i.intern ? "intern" : "alle";
    const warten = (grund: Wartegrund): Planeintrag => ({
      installationId: i.id,
      welle,
      ergebnis: { art: "wartet", grund },
    });
    if (stand.stoerungAm !== undefined) return warten("angehalten");
    if (!i.automatisch) return warten("nur_von_hand");
    const ab = welle === "intern" ? jetzt : alle;
    if (typeof ab === "string") return warten(ab);
    const freigabe = freigaben.some((f) => f.installationId === i.id && gueltig(f));
    return {
      installationId: i.id,
      welle,
      ergebnis: termin(i, update, Math.max(ab, jetzt), freigabe),
    };
  });
};

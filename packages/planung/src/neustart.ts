import {
  naechsterTermin,
  type Sperrzeit,
  sperrzeitAm,
  TAG_MS,
  type Wartungsfenster,
} from "./fenster.ts";

/*
 * When the Zentrale reboots a server (BAULISTE.md Z-701; docs/plan.md, "Wann ein Server neu
 * startet"): only when its facts say a reboot is needed and name the boot, its agent is connected,
 * no job is open on the server (one update, agent update or reboot per server), every running
 * installation that has data to back up has its backups set up (a backup of each comes first), the
 * last reboot of the server ended more than a day ago, inside the server's maintenance window and
 * outside every freeze window of every app on the server. Pure: the Zentrale's loop asks it for each
 * server, and for one it made, whether it may still go out (`neustartZustellbar`).
 */

/** After a reboot of the server ended, however, the next one comes a day later at the earliest */
export const NEUSTART_PAUSE_MS = TAG_MS;

export type NeustartServer = {
  /** From the newest facts; null when the agent could not tell or sent none yet */
  neustartNoetig: boolean | null;
  bootId: string | null;
  wartungsfenster: Wartungsfenster;
  /** Of the apps on the server: each installation's manifest and the new one of an open update */
  sperrzeiten: readonly Sperrzeit[];
  verbunden: boolean;
  /** Jobs on the server that have not ended */
  offeneAuftraege: number;
  /** Running installations with parts to back up whose backups are not set up */
  ohneBackup: number;
  /** When the last reboot of the server ended, if one did */
  letzterNeustartAm?: number;
};

export type NeustartWartegrund =
  | "unbekannt"
  | "nicht_noetig"
  | "getrennt"
  | "auftraege"
  | "backup_fehlt"
  | "versucht"
  | "sperrzeit"
  | "fenster"
  | "kein_termin";

export type NeustartEntscheid =
  | { art: "jetzt" }
  | { art: "warten"; grund: NeustartWartegrund; ab?: number };

const warten = (grund: NeustartWartegrund, ab?: number): NeustartEntscheid =>
  ab === undefined ? { art: "warten", grund } : { art: "warten", grund, ab };

/** Inside the window and outside every freeze window now, or why not and when next */
const termin = (s: NeustartServer, jetzt: number): NeustartEntscheid => {
  const naechster = naechsterTermin([s.wartungsfenster], s.sperrzeiten, jetzt);
  if (naechster === jetzt) return { art: "jetzt" };
  const grund = sperrzeitAm(s.sperrzeiten, jetzt) ? "sperrzeit" : "fenster";
  return naechster === undefined ? warten("kein_termin") : warten(grund, naechster);
};

export const neustartPruefen = (s: NeustartServer, jetzt: number): NeustartEntscheid => {
  if (s.neustartNoetig === null || s.bootId === null) return warten("unbekannt");
  if (!s.neustartNoetig) return warten("nicht_noetig");
  if (!s.verbunden) return warten("getrennt");
  if (s.offeneAuftraege > 0) return warten("auftraege");
  if (s.ohneBackup > 0) return warten("backup_fehlt");
  if (s.letzterNeustartAm !== undefined && jetzt - s.letzterNeustartAm < NEUSTART_PAUSE_MS)
    return warten("versucht", s.letzterNeustartAm + NEUSTART_PAUSE_MS);
  return termin(s, jetzt);
};

/**
 * Whether a reboot the agent has not acknowledged yet may go out now: never in a freeze window of an
 * app on the server, and one the plan made only inside the maintenance window (its backups before
 * may have run past it). Pass no window for one made by hand.
 */
export const neustartZustellbar = (
  sperrzeiten: readonly Sperrzeit[],
  fenster: Wartungsfenster | undefined,
  jetzt: number,
): boolean => {
  if (sperrzeitAm(sperrzeiten, jetzt)) return false;
  return fenster === undefined || naechsterTermin([fenster], [], jetzt) === jetzt;
};

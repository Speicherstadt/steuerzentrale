import { m } from "@steuerzentrale/ui";
import { zeitpunkt } from "../format/zeit.ts";
import { welleName } from "../rahmen/texte.ts";
import type { PlanStand, UpdateStand, Wartegrund } from "./apps.ts";

/*
 * The plan and the last update of an installation in words (BAULISTE.md Z-503), for the page
 * "Updates": the next slot of its wave or why it waits, and where its last update stands or how it
 * ended, with the agent's reason. `jetzt` names "today" and "yesterday".
 */

const WARTEN: Record<Wartegrund, (p: { version: string }) => string> = {
  angehalten: m.upd_plan_angehalten,
  nur_von_hand: m.upd_plan_nur_von_hand,
  vorabversion: m.upd_plan_vorabversion,
  intern_laeuft: m.upd_plan_intern_laeuft,
  freigabe_noetig: m.upd_plan_freigabe_noetig,
  kein_termin: m.upd_plan_kein_termin,
};

export const planText = (p: PlanStand | null, jetzt: number): string => {
  if (!p) return m.upd_aktuell();
  if (p.art === "wartet") return WARTEN[p.grund]({ version: p.version });
  return m.upd_plan_termin({
    version: p.version,
    welle: welleName(p.welle),
    zeit: zeitpunkt(p.ab, jetzt),
  });
};

export const updateText = (u: UpdateStand, jetzt: number): string => {
  const l = u.letzter;
  if (!l) return m.upd_noch_keins();
  const version = l.nachVersion;
  if (l.phase === "sichern") return m.upd_phase_sichern({ version });
  if (l.phase === "aktualisieren") return m.upd_phase_aktualisieren({ version });
  const zeit = zeitpunkt(l.endeAm ?? l.angefordertAm, jetzt);
  const grund = l.fehler ?? "–";
  switch (l.phase) {
    case "aktualisiert":
      return m.upd_phase_aktualisiert({ zeit, version });
    case "zurueckgenommen":
      return m.upd_phase_zurueckgenommen({ zeit, version, von: l.vonVersion, grund });
    case "ruecknahme_unvollstaendig":
      return m.upd_phase_ruecknahme_unvollstaendig({ zeit, version, grund });
    case "gescheitert":
      return m.upd_phase_gescheitert({ zeit, version, grund });
    case "abgebrochen":
      return m.upd_phase_abgebrochen({ zeit, version, grund });
  }
};

/** Whether the last update ended without the new version: rolled back, failed or cancelled */
export const updateMisslungen = (u: UpdateStand): boolean =>
  u.letzter !== null && !u.laeuft && u.letzter.phase !== "aktualisiert";

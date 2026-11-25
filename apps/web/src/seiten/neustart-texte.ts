import type { NeustartWartegrund } from "@steuerzentrale/planung";
import { m } from "@steuerzentrale/ui";
import type { NeustartStand, ServerFakten } from "../daten/server.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { auftragsZustandText } from "./installieren-texte.ts";

/*
 * The texts of a server's operating system and reboot (BAULISTE.md Z-701): unattended-upgrades,
 * whether a reboot is needed, what the plan decides now (docs/plan.md, "Wann ein Server neu
 * startet") and how the last reboot ended. Pure: they take the API's values and the time.
 */

export const unattendedText = (
  u: ServerFakten["unattendedUpgrades"],
  jetzt: number,
): string | null => {
  if (u === null) return null;
  if (!u.installiert) return m.server_unattended_fehlt();
  if (u.aktiv === null) return m.server_unbekannt();
  if (!u.aktiv) return m.server_unattended_aus();
  return u.letzterLauf === null
    ? m.server_unattended_an_nie()
    : m.server_unattended_an({ zeit: zeitpunkt(u.letzterLauf, jetzt) });
};

/** "Neustart nötig": yes with the kernel it waits for, no, or unknown (null) */
export const noetigText = (
  noetig: boolean | null,
  kernel: { laeuft: string | null; installiert: string | null },
): string | null => {
  if (noetig === null) return null;
  if (!noetig) return m.nein();
  return kernel.installiert && kernel.installiert !== kernel.laeuft
    ? m.server_neustart_ja_kernel({ kernel: kernel.installiert })
    : m.ja();
};

const WARTEN: Record<NeustartWartegrund, (zeit: string) => string> = {
  unbekannt: () => m.server_neustart_unbekannt(),
  nicht_noetig: () => m.server_kein_neustart(),
  getrennt: () => m.server_neustart_getrennt(),
  auftraege: () => m.server_neustart_auftraege(),
  backup_fehlt: () => m.server_neustart_backup_fehlt(),
  versucht: (zeit) => m.server_neustart_versucht({ zeit }),
  sperrzeit: (zeit) => m.server_neustart_sperrzeit({ zeit }),
  fenster: (zeit) => m.server_neustart_fenster({ zeit }),
  kein_termin: () => m.server_neustart_kein_termin(),
};

/** What the plan decides for the server now */
export const planText = (plan: NeustartStand["plan"], jetzt: number): string =>
  plan.art === "jetzt"
    ? m.server_neustart_jetzt()
    : WARTEN[plan.grund](plan.ab === undefined ? "" : zeitpunkt(plan.ab, jetzt));

/** How the newest reboot stands or ended, by hand or by the plan, and why it failed */
export const letzterText = (letzter: NeustartStand["letzter"], jetzt: number): string | null => {
  if (letzter === null) return null;
  const zustand = auftragsZustandText(letzter.zustand as Parameters<typeof auftragsZustandText>[0]);
  const wann = zeitpunkt(letzter.geaendertAm, jetzt);
  const von = letzter.vonHand ? m.server_neustart_von_hand() : m.server_neustart_geplant();
  return letzter.fehler
    ? m.server_neustart_letzter_fehler({ zustand, fehler: letzter.fehler, wann, von })
    : m.server_neustart_letzter({ zustand, wann, von });
};

const FEHLER: Record<string, () => string> = {
  auftrag_offen: m.server_neustart_fehler_auftrag_offen,
  sperrzeit: m.server_neustart_fehler_sperrzeit,
  backup_fehlt: m.server_neustart_fehler_backup_fehlt,
  unbekannt: m.server_neustart_fehler_unbekannt,
  nicht_beigetreten: m.server_neustart_fehler_unbekannt,
  server_gesperrt: m.server_neustart_fehler_gesperrt,
  nur_beobachten: m.server_neustart_fehler_nur_beobachten,
};

/** Why the Zentrale refused a reboot by hand, as one sentence */
export const neustartFehler = (f: { fehler: string; detail?: string | undefined }): string => {
  const text = FEHLER[f.fehler]?.() ?? m.server_neustart_fehler_sonst({ fehler: f.fehler });
  return f.detail && f.fehler === "sperrzeit" ? `${text} (${f.detail})` : text;
};

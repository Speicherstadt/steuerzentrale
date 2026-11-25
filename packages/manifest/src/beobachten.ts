import { AGENT_UPDATE_AKTION } from "./agent-update.ts";
import { AKTIONS_AUFTRAEGE } from "./aktionen.ts";
import { ABWICKLUNG_AKTIONEN } from "./backup/abwicklung.ts";
import { BACKUP_AKTIONEN } from "./backup/auftraege.ts";
import { PRUEF_RESTORE_AKTION } from "./backup/pruef-restore.ts";
import { WIEDERHERSTELLEN_AKTION } from "./backup/wiederherstellen.ts";
import { EINRICHTUNG_AKTIONEN } from "./einrichtung/auftraege.ts";
import { UPDATE_AKTION } from "./einrichtung/update.ts";
import { PFORTE_AKTIONEN } from "./pforte/auftraege.ts";
import { SERVER_NEUSTART_AKTION } from "./server-neustart.ts";

/*
 * A server that is only observed (BAULISTE.md Z-1102; docs/plan.md, "Modus nur beobachten"): its
 * agent came with `install.sh --nur-beobachten` onto a server where something runs already, and
 * nothing of the Zentrale may change it. Its agent takes one kind of job only, its own update; the
 * Zentrale makes no other and the placement refuses the server. The same rule on both sides, so
 * neither has a list of its own; the agent's is what counts, as it holds the mode itself.
 */

/**
 * Every built-in kind of job besides the commands an app's manifest names: setting up, the
 * Pforte, restart and log, backups, the end of a contract, test restore, restore, update, reboot
 * and the agent's own update
 */
export const AUFTRAGS_ARTEN: readonly string[] = [
  ...Object.values(EINRICHTUNG_AKTIONEN),
  ...Object.values(PFORTE_AKTIONEN),
  ...Object.values(AKTIONS_AUFTRAEGE),
  ...Object.values(BACKUP_AKTIONEN),
  ...Object.values(ABWICKLUNG_AKTIONEN),
  PRUEF_RESTORE_AKTION,
  WIEDERHERSTELLEN_AKTION,
  UPDATE_AKTION,
  SERVER_NEUSTART_AKTION,
  AGENT_UPDATE_AKTION,
];

/** The jobs a server that is only observed takes: the update of its agent */
export const NUR_BEOBACHTEN_AKTIONEN: readonly string[] = [AGENT_UPDATE_AKTION];

/** Whether a job of `aktion` may go to (or run on) a server in that mode */
export const imBeobachtenErlaubt = (aktion: string): boolean =>
  NUR_BEOBACHTEN_AKTIONEN.includes(aktion);

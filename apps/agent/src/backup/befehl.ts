import { INSTALLATIONS_NAME } from "@steuerzentrale/manifest";
import type { Dateien } from "../dateien.ts";
import {
  BackupDatei,
  backupDateiPfad,
  type Lauf,
  STAND_LAEUFE,
  standDateiPfad,
  standLesen,
} from "./datei.ts";
import { repositoryAnlegen, type SichernDeps, sichern } from "./sichern.ts";

/*
 * `steuerzentrale-agent sichern <installation> [--repository-anlegen]` (BAULISTE.md Z-601), what
 * the user's service runs: as the installation's user only, never as root, from its backup.json.
 * A run is appended to backup-stand.json (atomically, the last STAND_LAEUFE runs), which the agent
 * reports; the exit code is 0 only for a run that went through, so systemd marks a failed one.
 * `--repository-anlegen` only creates the repository when setting up. What it prints names no
 * value of backup.json, only tags, snapshots and reasons.
 */

export type SichernBefehlDeps = {
  uid: () => number;
  home: () => string;
  dateien: Dateien;
  sichern: SichernDeps;
};

export const SICHERN_USAGE =
  "usage: steuerzentrale-agent sichern <installation> [--repository-anlegen]";

type Antwort = { code: number; out: string };

const json = (code: number, daten: Record<string, unknown>): Antwort => ({
  code,
  out: JSON.stringify(daten),
});

/** Appends the run to the stand file; a file that is not one is started anew */
export const standAnhaengen = async (dateien: Dateien, pfad: string, lauf: Lauf) => {
  const text = await dateien.lesen(pfad);
  const vorher = (text === undefined ? [] : standLesen(text)) ?? [];
  const laeufe = [...vorher, lauf].slice(-STAND_LAEUFE);
  await dateien.schreiben(pfad, JSON.stringify({ laeufe }), 0o600);
};

const dateiLesen = async (
  deps: SichernBefehlDeps,
  installation: string,
): Promise<BackupDatei | string> => {
  const pfad = backupDateiPfad(deps.home());
  const text = await deps.dateien.lesen(pfad);
  if (text === undefined) return `${pfad} is missing: the backup is not set up`;
  try {
    const g = BackupDatei.safeParse(JSON.parse(text));
    if (g.success && g.data.installation === installation) return g.data;
  } catch {
    // not JSON: the same answer as a wrong shape
  }
  return `${pfad} is not the backup of ${installation}`;
};

export const sichernBefehl = async (args: string[], deps: SichernBefehlDeps): Promise<Antwort> => {
  const [installation = "", ...rest] = args;
  const anlegen = rest.length === 1 && rest[0] === "--repository-anlegen";
  if (!INSTALLATIONS_NAME.test(installation) || (rest.length > 0 && !anlegen))
    return { code: 2, out: SICHERN_USAGE };
  // as root, Podman would use root's storage and reach every installation's volumes
  if (deps.uid() === 0)
    return json(1, {
      msg: "refusing to back up",
      grund: "sichern runs as the installation's user",
    });
  const d = await dateiLesen(deps, installation);
  if (typeof d === "string") return json(1, { msg: "refusing to back up", grund: d });
  if (anlegen) {
    const r = await repositoryAnlegen(deps.sichern, d);
    return json(r.ok ? 0 : 1, { msg: "repository", ...r });
  }
  const lauf = await sichern(deps.sichern, d);
  try {
    await standAnhaengen(deps.dateien, standDateiPfad(deps.home()), lauf);
  } catch (fehler) {
    return json(1, { msg: "backup stand not written", lauf: lauf.lauf, grund: String(fehler) });
  }
  return json(lauf.ok ? 0 : 1, { msg: "backup", ...lauf });
};

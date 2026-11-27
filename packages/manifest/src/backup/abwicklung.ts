import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import type { Manifest } from "../schema.ts";
import { type BackupAnfrage, type BackupTeil, backupTeile } from "./auftraege.ts";

/*
 * The two jobs after a contract ended (BAULISTE.md Z-604; docs/plan.md, "Kündigung und Löschung"),
 * built in like the backup jobs, with a fixed shape and nothing from the job but the region:
 * - `installation_archiv`: the agent's binary, as the installation's user, writes the newest
 *   snapshot of each part of its backup as one file (a volume as tar, a dump or a command's output
 *   as it was saved) and uploads it with the installation's own S3 access next to its repository,
 *   `<prefix>archiv/<file>`, where the Zentrale's pre-signed link finds it;
 * - `installation_loeschen`: the agent takes down an installation it set up and finished, but only
 *   after a successful backup run of it in the last two hours (the Zentrale sends `installation_backup`
 *   right before), so nothing is deleted without a backup first; with parts to back up in the
 *   manifest and its backup not set up, it deletes nothing (AGENTS.md, "Nie").
 * Pure: the Zentrale checks a job with it when it makes one, the agent again after key and signature.
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name these */
export const ABWICKLUNG_AKTIONEN = {
  archiv: "installation_archiv",
  loeschen: "installation_loeschen",
} as const;

/** Writing and uploading each part: as long as a backup run may take */
export const ARCHIV_ZEITLIMIT_S = 4 * 3600;

/** Taking the installation down: stopping its units, removing its user */
export const LOESCHEN_ZEITLIMIT_S = 1800;

/** How recent the backup before deleting must be: it ran in the job just before */
export const LOESCHEN_BACKUP_MS = 2 * 3600_000;

/** The folder of the archive below the installation's prefix */
export const ARCHIV_ORDNER = "archiv/";

/** An S3 region as MinIO and AWS name them */
const REGION = /^[a-z0-9-]{1,32}$/;

export type AbwicklungAuftrag =
  | { art: "archiv"; name: string; region: string; teile: BackupTeil[] }
  /** `mitBackup`: the manifest names parts to back up, so the agent deletes only after a backup */
  | { art: "loeschen"; name: string; mitBackup: boolean };

export type AbwicklungGeprueft =
  | { ok: true; auftrag: AbwicklungAuftrag }
  | { ok: false; grund: string };

export const istAbwicklungAktion = (aktion: string): boolean =>
  Object.values<string>(ABWICKLUNG_AKTIONEN).includes(aktion);

/** The file of a part in the archive: its tag with `-` for `:`, a volume as tar */
export const archivDatei = (t: BackupTeil): string => {
  const name = t.tag.replaceAll(":", "-");
  return t.art === "volume" ? `${name}.tar` : `${name}-${t.dateiname}`;
};

const nein = (grund: string): AbwicklungGeprueft => ({ ok: false, grund });

export const abwicklungAuftragPruefen = (m: Manifest, a: BackupAnfrage): AbwicklungGeprueft => {
  if (!istAbwicklungAktion(a.aktion)) return nein(`${a.aktion} is not a job after a contract`);
  const name = a.installationId;
  if (name === null || !INSTALLATIONS_NAME.test(name))
    return nein("the job belongs to a named installation");
  if (a.einrichtung !== undefined || a.backup !== undefined)
    return nein("the job takes neither installation nor backup data");
  const { region, ...fremd } = a.argumente;
  if (Object.keys(fremd).length > 0)
    return nein(`unknown argument ${Object.keys(fremd).join(", ")}`);
  if (a.aktion === ABWICKLUNG_AKTIONEN.loeschen)
    return region === undefined
      ? { ok: true, auftrag: { art: "loeschen", name, mitBackup: m.backup.length > 0 } }
      : nein("unknown argument region");
  if (typeof region !== "string" || !REGION.test(region))
    return nein("region: an S3 region of a-z, 0-9 and -");
  const teile = backupTeile(m, name);
  if (!teile.ok) return teile;
  return { ok: true, auftrag: { art: "archiv", name, region, teile: teile.teile } };
};

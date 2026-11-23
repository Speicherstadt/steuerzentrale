import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Datenbank, unversehrt } from "../../db/oeffnen.ts";

/*
 * Backing up and restoring the Zentrale (BAULISTE.md Z-1002; docs/plan.md, "Sicherung der Zentrale"):
 * `steuerzentrale sichern <datei>` writes the database as one consistent file, which restic then
 * takes to the operator's S3 target; `steuerzentrale wiederherstellen <datei>` puts such a file
 * into the empty data directory of a new server. The file holds every secret only encrypted with
 * STEUERZENTRALE_SECRET_KEY, the agents' CAs among them; the key itself is kept apart.
 */

/** The database's file in the data directory (main.ts) */
export const DATEI = "zentrale.db";

export type Ergebnis = { ok: true } | { ok: false; grund: string };

const fehler = (grund: string): Ergebnis => ({ ok: false, grund });
const grundAus = (e: unknown) => String((e as Error)?.message ?? e);

/** The file and what SQLite may have left beside it */
const wegraeumen = (pfad: string) => {
  for (const endung of ["", "-wal", "-shm", "-journal"])
    rmSync(`${pfad}${endung}`, { force: true });
};

/**
 * Writes a consistent copy of the open database to `ziel`: first into `<ziel>.neu`, made empty and
 * readable for this user alone before a byte goes in, then renamed over `ziel`, so a backup that
 * fails halfway never replaces the last good one
 */
export const sichern = (
  datenbank: Pick<Datenbank, "sicherungSchreiben">,
  ziel: string,
): Ergebnis => {
  const neu = `${ziel}.neu`;
  try {
    wegraeumen(neu);
    writeFileSync(neu, "", { mode: 0o600, flag: "wx" });
    datenbank.sicherungSchreiben(neu);
    if (!unversehrt(neu)) throw new Error("the copy did not pass the integrity check");
    chmodSync(neu, 0o600);
    renameSync(neu, ziel);
    return { ok: true };
  } catch (e) {
    wegraeumen(neu);
    return fehler(`backup failed: ${grundAus(e)}`);
  }
};

/**
 * Puts the backup `quelle` into the data directory `daten`, which must not hold a database yet
 * (a new server, or the old directory moved aside): copied to `<datei>.wiederherstellen`, checked
 * for damage, opened with the key (`oeffnen` applies newer migrations and refuses a key that does
 * not open it), then renamed to the database's name; on any failure nothing stays behind
 */
export const wiederherstellen = (
  quelle: string,
  daten: string,
  oeffnen: (pfad: string) => Pick<Datenbank, "schliessen">,
): Ergebnis => {
  const ziel = join(daten, DATEI);
  if (existsSync(ziel) || existsSync(`${ziel}-wal`))
    return fehler(`${daten} already holds a database: restore only into an empty data directory`);
  if (!existsSync(quelle)) return fehler(`no backup at ${quelle}`);
  const zwischen = `${ziel}.wiederherstellen`;
  try {
    mkdirSync(daten, { recursive: true, mode: 0o700 });
    wegraeumen(zwischen);
    copyFileSync(quelle, zwischen, constants.COPYFILE_EXCL);
    chmodSync(zwischen, 0o600);
    if (!unversehrt(zwischen)) throw new Error(`${quelle} is not an undamaged database`);
    oeffnen(zwischen).schliessen();
    renameSync(zwischen, ziel);
    return { ok: true };
  } catch (e) {
    wegraeumen(zwischen);
    return fehler(`restore failed: ${grundAus(e)}`);
  }
};

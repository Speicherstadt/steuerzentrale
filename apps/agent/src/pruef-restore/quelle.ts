import { BACKUP_ORDNER, BackupDatei, backupDateiPfad } from "../backup/datei.ts";
import type { HausDateien } from "../einrichtung/haus.ts";
import { homeVon, type Nutzer } from "../einrichtung/nutzer.ts";

/*
 * The backup of the installation whose snapshots are played back (Z-602): its backup.json, read
 * as root and only read. Each folder from the home down is checked before (no symlink the user put
 * there, haus.ts), the file is read without following one, and it must name the installation.
 * A missing folder or file means the backup is not set up: nothing is made in the home. No value
 * of the file reaches a reason.
 */

export type QuelleGelesen = { ok: true; datei: BackupDatei } | { ok: false; grund: string };

export const quelleLesen = async (
  haus: HausDateien,
  n: Nutzer,
  installation: string,
): Promise<QuelleGelesen> => {
  const home = homeVon(installation);
  const nicht = {
    ok: false,
    grund: `das Backup von ${installation} ist nicht eingerichtet`,
  } as const;
  try {
    const teile = BACKUP_ORDNER.split("/");
    for (let i = 1; i <= teile.length; i++) {
      const ordner = `${home}/${teile.slice(0, i).join("/")}`;
      if (!(await haus.existiert(ordner))) return nicht;
      // the backup set these folders up with this mode and owner (backup/auftrag.ts)
      await haus.verzeichnis(ordner, 0o700, n);
    }
    const text = await haus.dateiLesen(backupDateiPfad(home));
    if (text === undefined) return nicht;
    const g = BackupDatei.safeParse(JSON.parse(text));
    if (g.success && g.data.installation === installation) return { ok: true, datei: g.data };
  } catch {
    // a symlink, no regular file or no JSON: the same answer as a wrong shape
  }
  return { ok: false, grund: `backup.json von ${installation} ist nicht lesbar` };
};

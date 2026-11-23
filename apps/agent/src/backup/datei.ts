import { BackupLauf } from "@steuerzentrale/protokoll";
import { z } from "zod";

/*
 * The two files of an installation's backup in its user's home (docs/plan.md, "Backup auf dem
 * Server"), both 0600 and the user's: `backup.json`, which the agent writes as root when the backup
 * is set up (repository, S3 access, restic password and the parts resolved from the signed
 * manifest), and `backup-stand.json`, in which `sichern` keeps its last runs for the agent to
 * report. Each side reads the other's file only through its schema.
 */

export const BACKUP_ORDNER = ".config/steuerzentrale";

export const backupDateiPfad = (home: string): string => `${home}/${BACKUP_ORDNER}/backup.json`;
export const standDateiPfad = (home: string): string =>
  `${home}/${BACKUP_ORDNER}/backup-stand.json`;

/** The last runs a stand file keeps: two weeks of daily runs, enough for a long disconnection */
export const STAND_LAEUFE = 14;

const wort = z.string().min(1).max(1000);

const teil = z.discriminatedUnion("art", [
  z.object({ art: z.literal("volume"), tag: wort, volume: wort, pfad: wort }),
  z.object({
    art: z.enum(["pg_dump", "befehl"]),
    tag: wort,
    container: wort,
    argv: z.array(z.string()).min(1),
    dateiname: wort,
    zeitlimitS: z.number().int().positive().optional(),
  }),
]);

export const BackupDatei = z.object({
  installation: wort,
  repository: wort,
  zugang: z.object({ schluesselId: wort, geheim: wort }),
  passwort: wort,
  teile: z.array(teil).min(1).max(100),
});
export type BackupDatei = z.output<typeof BackupDatei>;

export const StandDatei = z.object({ laeufe: z.array(BackupLauf).max(STAND_LAEUFE) });
export type Lauf = z.output<typeof BackupLauf>;

/** The runs of a stand file, oldest first; undefined when it is not one */
export const standLesen = (text: string): Lauf[] | undefined => {
  try {
    const g = StandDatei.safeParse(JSON.parse(text));
    return g.success ? g.data.laeufe : undefined;
  } catch {
    return undefined;
  }
};

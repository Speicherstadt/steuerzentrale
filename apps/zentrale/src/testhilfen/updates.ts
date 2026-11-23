import { BACKUP_AKTIONEN, UPDATE_AKTION } from "@steuerzentrale/manifest";
import { updates } from "../db/schema.ts";
import { type UpdateWunsch, updateAnlegen } from "../modules/updates/index.ts";
import { TEST_SCHLUESSEL, type Testmanifest } from "./installationen.ts";
import { SNAPSHOT } from "./pruef-restore.ts";
import { wiederherstellenUmgebung } from "./wiederherstellen.ts";

/*
 * For the tests of updates (Z-503): the environment of restores (testhilfen/wiederherstellen.ts),
 * with an installation of `gesichert` (1.0.3) whose backups are set up, the newer versions it can go
 * to imported, an update made as by hand, its two jobs, and the agent's reports of their results:
 * the backup before as `installation_backup` reports it (apps/agent, backup/auftrag.ts), the update
 * with `daten` as packages/manifest, einrichtung/update.ts reads them.
 */

type Nachbau = Parameters<typeof wiederherstellenUmgebung>[0];

export const GRUND = "Sicherheitsupdate laut Hinweis des Herstellers";

/** The result of a backup run with a snapshot of the volume; the command's part has none */
export const backupDaten = (snapshot: string | null = SNAPSHOT) => ({
  installation: "x",
  lauf: crypto.randomUUID(),
  teile: [
    { tag: "volume:daten", ok: true, ...(snapshot ? { snapshot } : {}) },
    { tag: "befehl:sichern", ok: true },
  ],
});

export const updateUmgebung = (minio: Nachbau, betreiberId = "b1") => {
  const u = wiederherstellenUmgebung(minio, betreiberId);

  /** Imports the newer versions an update goes to */
  const versionen = (...namen: Testmanifest[]) => {
    for (const name of namen) u.manifest(name, betreiberId);
  };

  const anlegen = (
    installationId: string,
    wunsch: Partial<UpdateWunsch> = {},
    kontext: Partial<ReturnType<typeof u.kontext>> = {},
  ) =>
    updateAnlegen(
      u.deps,
      { ...u.kontext(betreiberId), jetzt: u.uhr.ms, grund: GRUND, ...kontext },
      TEST_SCHLUESSEL,
      installationId,
      { version: "1.3.0", anlass: "hand", sperrzeitUebergehen: false, ...wunsch },
    );

  /** The backup before and the update of the installation's newest update */
  const updateAuftraege = (installationId: string) => ({
    backup: u.auftrag(installationId, BACKUP_AKTIONEN.jetzt),
    update: u.auftrag(installationId, UPDATE_AKTION),
  });

  /** The backup before succeeds with a snapshot of each part played back */
  const gesichert = (installationId: string, snapshot: string | null = SNAPSHOT) =>
    u.ergebnisMelden(updateAuftraege(installationId).backup?.auftragId ?? "", {
      ok: true,
      daten: backupDaten(snapshot),
    });

  /** The agent reports the update's end in `daten` */
  const beendet = (installationId: string, daten: Record<string, unknown>) =>
    u.ergebnisMelden(updateAuftraege(installationId).update?.auftragId ?? "", { ok: true, daten });

  const zeilen = () => u.db.select().from(updates).all();

  return { ...u, versionen, anlegen, updateAuftraege, gesichert, beendet, zeilen };
};

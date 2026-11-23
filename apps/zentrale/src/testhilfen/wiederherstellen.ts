import { BACKUP_AKTIONEN, WIEDERHERSTELLEN_AKTION } from "@steuerzentrale/manifest";
import { and, desc, eq } from "drizzle-orm";
import { auftraege, backups } from "../db/schema.ts";
import type { AuftragsMeldung } from "../modules/auftraege/melden.ts";
import { pruefUmgebung } from "./pruef-restore.ts";

/*
 * For the tests of restoring (Z-603): the environment of test restores (testhilfen/pruef-restore.ts)
 * with the id of each run as the Zentrale keeps it, the jobs of a restore and the agent's report of
 * their results.
 */

type Nachbau = Parameters<typeof pruefUmgebung>[0];
type Ergebnis = Extract<AuftragsMeldung, { typ: "ergebnis" }>["ergebnis"];

export const wiederherstellenUmgebung = (minio: Nachbau, betreiberId = "b1") => {
  const u = pruefUmgebung(minio, betreiberId);

  /** A run of the installation reported a second later than the last; its id */
  const laufId = (installationId: string, ok = true, serverId = "s1"): string => {
    u.uhr.ms += 1000;
    u.lauf(installationId, ok, serverId);
    const neuester = u.db
      .select({ id: backups.backupId })
      .from(backups)
      .where(and(eq(backups.betreiberId, betreiberId), eq(backups.installationId, installationId)))
      .orderBy(desc(backups.zeitpunkt))
      .get();
    if (!neuester) throw new Error("no run");
    return neuester.id;
  };

  /** The installation's newest job of this action */
  const neuester = (installationId: string, aktion: string) =>
    u.db
      .select()
      .from(auftraege)
      .all()
      .filter((a) => a.installationId === installationId && a.aktion === aktion)
      .at(-1);

  /** The backup of the current state and the restore of the installation's newest restore */
  const auftraegeVon = (installationId: string) => ({
    backup: neuester(installationId, BACKUP_AKTIONEN.jetzt),
    wiederherstellen: neuester(installationId, WIEDERHERSTELLEN_AKTION),
  });

  /** The agent acknowledges the job and reports its result */
  const ergebnisMelden = (auftragId: string, e: Ergebnis) =>
    u.pruefMelden(auftragId, u.ergebnis(auftragId, e));

  return { ...u, laufId, auftraegeVon, ergebnisMelden };
};

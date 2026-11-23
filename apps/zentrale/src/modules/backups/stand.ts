import { createHash } from "node:crypto";
import type { NachrichtVomAgenten } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { backups } from "../../db/schema.ts";
import type { LogSink } from "../../log.ts";
import { schreiben } from "../audit/index.ts";
import { installationLesen } from "../installationen/lesen.ts";
import type { Server } from "../server/index.ts";

/*
 * What an agent reports of its installations' backups (BAULISTE.md Z-601; docs/plan.md, "Backup auf
 * dem Server (Z-601)"): each run as a row in `backups` of the operator, through the audit log; a
 * failed run also as the event `backup_gescheitert` (severity `fehler`). Only for an installation
 * of this server and operator: any other report is dropped and logged, as the state of an
 * installation is (Z-403). The agent sends the newest run again at every connection: a run is known
 * by its `lauf`, so it stays one row and one event; its time is its end on the agent, never later
 * than now.
 */

type BackupStand = Extract<NachrichtVomAgenten, { typ: "backup_stand" }>;

export const BACKUP_GESCHEITERT_ART = "backup_gescheitert";

export type StandDeps = { db: Db; schreibDb: SchreibDb; log: LogSink };

export type StandAngenommen = { ok: true; neu: boolean } | { ok: false; grund: string };

const backupIdVon = (serverId: string, n: BackupStand) =>
  `backup-${createHash("sha256")
    .update(JSON.stringify([serverId, n.installationId, n.lauf]))
    .digest("hex")
    .slice(0, 32)}`;

const vorhanden = (db: Db, betreiberId: string, backupId: string) =>
  db
    .select({ id: backups.backupId })
    .from(backups)
    .where(and(eq(backups.betreiberId, betreiberId), eq(backups.backupId, backupId)))
    .get() !== undefined;

export const backupStandAnnehmen = (
  deps: StandDeps,
  server: Server,
  n: BackupStand,
  jetzt: number,
): StandAngenommen => {
  const { betreiberId, serverId } = server;
  const i = installationLesen(deps.db, betreiberId, n.installationId);
  if (!i || i.serverId !== serverId) {
    deps.log(
      JSON.stringify({
        msg: "backup report dropped",
        serverId,
        installationId: n.installationId,
      }),
    );
    return { ok: false, grund: "not an installation of this server" };
  }
  const backupId = backupIdVon(serverId, n);
  if (vorhanden(deps.db, betreiberId, backupId)) return { ok: true, neu: false };
  const zeitpunkt = Math.min(n.ende, jetzt);
  const grund = n.ok ? null : (n.fehler ?? "ohne Grund");
  const kontext = {
    betreiberId,
    akteur: `server:${serverId}`,
    jetzt,
    grund: "Agent meldet ein Backup",
  };
  schreiben(deps.schreibDb, kontext, "backup.stand", (w) => {
    w.einfuegen("backups", {
      betreiberId,
      backupId,
      installationId: i.installationId,
      serverId,
      zeitpunkt,
      ok: n.ok,
      teile: JSON.stringify(n.teile),
      grund,
      gemeldetAm: jetzt,
    });
    if (!n.ok)
      w.einfuegen("ereignisse", {
        betreiberId,
        ereignisId: backupId,
        zeitpunkt,
        art: BACKUP_GESCHEITERT_ART,
        schwere: "fehler",
        ziel: `installation:${i.installationId}`,
        text: `Backup von ${i.installationId} gescheitert: ${grund}`,
      });
  });
  return { ok: true, neu: true };
};

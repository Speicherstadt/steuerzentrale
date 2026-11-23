import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { installationen } from "./schema-installationen.ts";

/*
 * The tables of backups (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und Zugang je Installation
 * (Z-601)", "Backup auf dem Server (Z-601)"), re-exported by schema.ts; each carries betreiber_id.
 */

/**
 * The operator's S3 target: endpoint, region and bucket. The admin access (access key and secret
 * key) is a secret of the operator in `geheimnisse` (modules/backups/ziel.ts), never in this row.
 */
export const backupZiele = sqliteTable("backup_ziele", {
  betreiberId: text("betreiber_id").primaryKey(),
  endpunkt: text("endpunkt").notNull(),
  region: text("region").notNull(),
  bucket: text("bucket").notNull(),
  geaendertAm: integer("geaendert_am").notNull(),
});

/**
 * Where an installation's own S3 access stands at MinIO: to be made, made, to be deleted, deleted
 * (like `installationen.dns`)
 */
export const BACKUP_ZUGANG_ZUSTAENDE = ["anlegen", "angelegt", "loeschen", "geloescht"] as const;

/**
 * An installation's own S3 access and its restic password (Z-601), made once its setup succeeded
 * for a manifest with parts to back up. `geheim` is encrypted JSON `{ accessKey, secretKey,
 * passwort }`; it leaves the Zentrale only in the job `installation_backup_einrichten` to the
 * installation's own server, and in the call that makes the access at MinIO. The row stays after
 * the access is deleted: the restic password still opens the repository (Z-604 deletes both).
 * `versuche` and `naechster_versuch` are the backoff of the calls to MinIO, as for DNS.
 */
export const backupZugaenge = sqliteTable(
  "backup_zugaenge",
  {
    betreiberId: text("betreiber_id").notNull(),
    installationId: text("installation_id").notNull(),
    zustand: text("zustand", { enum: BACKUP_ZUGANG_ZUSTAENDE }).notNull(),
    versuche: integer("versuche").notNull().default(0),
    naechsterVersuch: integer("naechster_versuch"),
    geheim: text("geheim").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
    geaendertAm: integer("geaendert_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.installationId] }),
    index("backup_zugaenge_faellig").on(t.naechsterVersuch),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

/**
 * One run of an installation's backup as its agent reported it (`backup_stand`): when it ran (the
 * agent's time, never later than its arrival), whether it succeeded, the parts that landed (JSON
 * `[{ tag, snapshotId }]`) and, for a failed run, why. `backup_id` comes from server,
 * installation and time, so a run reported twice stays one row. Kept 13 months like events.
 */
export const backups = sqliteTable(
  "backups",
  {
    betreiberId: text("betreiber_id").notNull(),
    backupId: text("backup_id").notNull(),
    installationId: text("installation_id").notNull(),
    serverId: text("server_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    teile: text("teile").notNull(),
    grund: text("grund"),
    gemeldetAm: integer("gemeldet_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.backupId] }),
    index("backups_installation").on(t.betreiberId, t.installationId, t.zeitpunkt),
    index("backups_zeitpunkt").on(t.zeitpunkt),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

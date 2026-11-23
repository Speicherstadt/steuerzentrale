import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { installationen } from "./schema-installationen.ts";

/*
 * The updates of installations (BAULISTE.md Z-503; docs/plan.md, "Update in der Zentrale (Z-503)"),
 * re-exported by schema.ts; carries betreiber_id like every table with an operator's data.
 */

/** Why an update was made: by hand, by a wave of the plan, or at once as an urgent one */
export const UPDATE_ANLAESSE = ["hand", "welle", "dringend"] as const;

/**
 * How an update ended: the new version holds; the agent rolled it back (completely, or not); it
 * failed without a known outcome (a refusal, an error, an unreadable result); or it was cancelled
 * before anything changed on the server (the backup before failed, or its snapshots were missing)
 */
export const UPDATE_ERGEBNISSE = [
  "aktualisiert",
  "zurueckgenommen",
  "ruecknahme_unvollstaendig",
  "gescheitert",
  "abgebrochen",
] as const;

/**
 * One update of an installation (Z-503), written with its two jobs: `backup_auftrag_id`
 * (installation_backup) backs up the current state first, `auftrag_id` (installation_update) with
 * the new version's signed manifest waits for it. `von_version` and `nach_version` name the step,
 * `anlass` and `welle` why it was made; `sperrzeit_uebergangen` marks an update the owner started
 * in a freeze window of the app, with a reason (the release, docs/plan.md "Updates"). Once it ends,
 * the row gets its end: `ergebnis`, the reason (`fehler`) and how long the agent took. Who asked
 * and why stands in the audit log. Kept for good, like the audit log: an update is rare and a
 * rolled-back one halts the waves of its version (packages/planung, `stoerungAm`).
 */
export const updates = sqliteTable(
  "updates",
  {
    betreiberId: text("betreiber_id").notNull(),
    auftragId: text("auftrag_id").notNull(),
    backupAuftragId: text("backup_auftrag_id").notNull(),
    installationId: text("installation_id").notNull(),
    serverId: text("server_id").notNull(),
    app: text("app").notNull(),
    vonVersion: text("von_version").notNull(),
    nachVersion: text("nach_version").notNull(),
    anlass: text("anlass", { enum: UPDATE_ANLAESSE }).notNull(),
    welle: text("welle"),
    sperrzeitUebergangen: integer("sperrzeit_uebergangen", { mode: "boolean" }).notNull(),
    angefordertAm: integer("angefordert_am").notNull(),
    endeAm: integer("ende_am"),
    ergebnis: text("ergebnis", { enum: UPDATE_ERGEBNISSE }),
    fehler: text("fehler"),
    dauerMs: integer("dauer_ms"),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.auftragId] }),
    index("updates_installation").on(t.betreiberId, t.installationId, t.angefordertAm),
    index("updates_backup_auftrag").on(t.betreiberId, t.backupAuftragId),
    index("updates_version").on(t.betreiberId, t.app, t.nachVersion),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

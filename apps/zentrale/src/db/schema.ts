import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/*
 * The tables of the Zentrale. Every table with data of an operator carries `betreiber_id`
 * (docs/plan.md, "Mandanten"); exempt are only manifests and Better Auth's tables (later items) and
 * the migrations' own bookkeeping (src/db/migrieren.ts). Instants are UTC milliseconds.
 */

/** An operator; partners are operators too (docs/plan.md, "Partner") */
export const betreiber = sqliteTable("betreiber", {
  betreiberId: text("betreiber_id").primaryKey(),
  name: text("name").notNull(),
  angelegtAm: integer("angelegt_am").notNull(),
});

/** Append-only (triggers in the migration): who did what to which target, when and why */
export const auditLog = sqliteTable(
  "audit_log",
  {
    nummer: integer("nummer").primaryKey({ autoIncrement: true }),
    betreiberId: text("betreiber_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    akteur: text("akteur").notNull(),
    aktion: text("aktion").notNull(),
    ziel: text("ziel").notNull(),
    grund: text("grund").notNull(),
    inhalt: text("inhalt").notNull(),
  },
  (t) => [index("audit_log_betreiber").on(t.betreiberId, t.zeitpunkt)],
);

/** One heartbeat of a server's agent (Z-303); kept 30 days (docs/plan.md, "Daten der Zentrale") */
export const heartbeats = sqliteTable(
  "heartbeats",
  {
    betreiberId: text("betreiber_id").notNull(),
    serverId: text("server_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    daten: text("daten").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.serverId, t.zeitpunkt] }),
    index("heartbeats_zeitpunkt").on(t.zeitpunkt),
  ],
);

/** A log excerpt in a job (Z-405); holds customer data, kept 30 days */
export const logAuszuege = sqliteTable(
  "log_auszuege",
  {
    betreiberId: text("betreiber_id").notNull(),
    auszugId: text("auszug_id").notNull(),
    auftragId: text("auftrag_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    inhalt: text("inhalt").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.auszugId] }),
    index("log_auszuege_zeitpunkt").on(t.zeitpunkt),
  ],
);

/** Something that happened (a failure, an SSH login, a deletion record); kept 13 months */
export const ereignisse = sqliteTable(
  "ereignisse",
  {
    betreiberId: text("betreiber_id").notNull(),
    ereignisId: text("ereignis_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    art: text("art").notNull(),
    schwere: text("schwere").notNull(),
    ziel: text("ziel").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.ereignisId] }),
    index("ereignisse_zeitpunkt").on(t.zeitpunkt),
  ],
);

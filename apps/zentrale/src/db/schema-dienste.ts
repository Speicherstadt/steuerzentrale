import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { kunden, server } from "./schema.ts";
import { AUSSEN_ZUSTAENDE } from "./schema-aussen.ts";

/*
 * Observed services (BAULISTE.md Z-1101; docs/plan.md, "Zuschnitt"): a service the Zentrale did not
 * install, checked from outside every minute like an installation (Z-704), re-exported by
 * schema.ts. The service itself is written through `schreiben`; its checks and hourly counts are
 * measurements, written only by modules/audit/messwerte.ts like those of installations.
 */

/**
 * A service of an operator: its name, its public host (the address is `https://<host>` on port
 * 443), the path of its health check and, if the operator wants, a customer. A removed service
 * keeps its row with `entfernt_am`, so its events and measurements still name it until the
 * retention ends them; it is no longer checked or listed. On a server that is only observed
 * (Z-1102) the agent may also read its units inside (Z-1103): `server_id`, the Linux user (null:
 * units of the system), the units as a JSON list and, if wanted, a check on 127.0.0.1 (`health_port`,
 * with `health_pfad` an HTTP check, without it a TCP check).
 */
export const dienste = sqliteTable(
  "dienste",
  {
    betreiberId: text("betreiber_id").notNull(),
    dienstId: text("dienst_id").notNull(),
    name: text("name").notNull(),
    host: text("host").notNull(),
    pfad: text("pfad").notNull(),
    kundeId: text("kunde_id"),
    angelegtAm: integer("angelegt_am").notNull(),
    entferntAm: integer("entfernt_am"),
    serverId: text("server_id"),
    nutzer: text("nutzer"),
    units: text("units"),
    healthPort: integer("health_port"),
    healthPfad: text("health_pfad"),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.dienstId] }),
    foreignKey({
      columns: [t.betreiberId, t.kundeId],
      foreignColumns: [kunden.betreiberId, kunden.kundeId],
    }),
    foreignKey({
      columns: [t.betreiberId, t.serverId],
      foreignColumns: [server.betreiberId, server.serverId],
    }),
    index("dienste_server").on(t.betreiberId, t.serverId),
  ],
);

/**
 * The newest rating of a service's units from inside (Z-1103), by the same rules as an
 * installation's (packages/planung, installationBewerten); unknown after 90 seconds without a report
 */
export const dienstInnen = sqliteTable(
  "dienst_innen",
  {
    betreiberId: text("betreiber_id").notNull(),
    dienstId: text("dienst_id").notNull(),
    bewertung: text("bewertung", { enum: ["gruen", "gelb", "rot", "unbekannt"] }).notNull(),
    grund: text("grund").notNull(),
    seit: integer("seit").notNull(),
    gemeldetAm: integer("gemeldet_am").notNull(),
    meldung: text("meldung").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.dienstId] }),
    foreignKey({
      columns: [t.betreiberId, t.dienstId],
      foreignColumns: [dienste.betreiberId, dienste.dienstId],
    }),
  ],
);

/** The newest check from outside of a service, as `aussen_pruefungen` holds it for an installation */
export const dienstPruefungen = sqliteTable(
  "dienst_pruefungen",
  {
    betreiberId: text("betreiber_id").notNull(),
    dienstId: text("dienst_id").notNull(),
    zustand: text("zustand", { enum: AUSSEN_ZUSTAENDE }).notNull(),
    grund: text("grund").notNull(),
    seit: integer("seit").notNull(),
    geprueftAm: integer("geprueft_am").notNull(),
    ergebnis: text("ergebnis").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.dienstId] }),
    foreignKey({
      columns: [t.betreiberId, t.dienstId],
      foreignColumns: [dienste.betreiberId, dienste.dienstId],
    }),
  ],
);

/** The checks of a service in one UTC hour, as `verfuegbarkeit` counts them for an installation */
export const dienstVerfuegbarkeit = sqliteTable(
  "dienst_verfuegbarkeit",
  {
    betreiberId: text("betreiber_id").notNull(),
    dienstId: text("dienst_id").notNull(),
    stunde: integer("stunde").notNull(),
    gemessen: integer("gemessen").notNull(),
    rot: integer("rot").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.dienstId, t.stunde] }),
    index("dienst_verfuegbarkeit_stunde").on(t.stunde),
    foreignKey({
      columns: [t.betreiberId, t.dienstId],
      foreignColumns: [dienste.betreiberId, dienste.dienstId],
    }),
  ],
);

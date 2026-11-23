import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { installationen } from "./schema-installationen.ts";

/*
 * The check from outside and the availability (BAULISTE.md Z-704; docs/plan.md, "Prüfung von
 * außen", "Verfügbarkeit"), re-exported by schema.ts. Both are measurements, written only by
 * modules/audit/messwerte.ts, like the rating the agent reports (Z-403).
 */

/** The result of a check from outside (packages/planung, `aussenBewerten`) */
export const AUSSEN_ZUSTAENDE = ["gruen", "rot"] as const;

/**
 * The newest check from outside of an installation, one row each: its state, the reason as JSON
 * `{ code, werte }`, since when the state holds, when it was checked, and `ergebnis`, JSON of what
 * each step answered (addresses, the certificate's end, status and time).
 */
export const aussenPruefungen = sqliteTable(
  "aussen_pruefungen",
  {
    betreiberId: text("betreiber_id").notNull(),
    installationId: text("installation_id").notNull(),
    zustand: text("zustand", { enum: AUSSEN_ZUSTAENDE }).notNull(),
    grund: text("grund").notNull(),
    seit: integer("seit").notNull(),
    geprueftAm: integer("geprueft_am").notNull(),
    ergebnis: text("ergebnis").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.installationId] }),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

/**
 * The checks from outside of an installation in one UTC hour (`stunde`, its first millisecond):
 * how many and how many red; the availability per month adds them up (packages/planung,
 * `verfuegbarkeitImMonat`). Kept 13 months like the events (src/modules/aufbewahrung).
 */
export const verfuegbarkeit = sqliteTable(
  "verfuegbarkeit",
  {
    betreiberId: text("betreiber_id").notNull(),
    installationId: text("installation_id").notNull(),
    stunde: integer("stunde").notNull(),
    gemessen: integer("gemessen").notNull(),
    rot: integer("rot").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.installationId, t.stunde] }),
    index("verfuegbarkeit_stunde").on(t.stunde),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

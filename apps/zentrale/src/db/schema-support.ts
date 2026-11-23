import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { installationen } from "./schema-installationen.ts";

/*
 * Support accesses (BAULISTE.md Z-802; docs/plan.md, "Support-Zugang"), re-exported by schema.ts;
 * carries betreiber_id like every table with an operator's data.
 */

/**
 * One support access of a member (`nutzer_id`) to one installation: from `beginn` until `ende`
 * (UTC milliseconds, at most 4 hours later), with its reason. Ended early, it carries `beendet_am`
 * and who ended it. `ende_gemeldet_am` is when the event of its end was written (ended by hand: at
 * once; run out: by the loop in modules/support), so each end makes exactly one event. The reason
 * and who started it also stand in the audit log; the row is kept like the audit log, since the
 * customer's support time is counted from it (Z-804).
 */
export const supportZugaenge = sqliteTable(
  "support_zugaenge",
  {
    betreiberId: text("betreiber_id").notNull(),
    zugangId: text("zugang_id").notNull(),
    installationId: text("installation_id").notNull(),
    nutzerId: text("nutzer_id").notNull(),
    grund: text("grund").notNull(),
    beginn: integer("beginn").notNull(),
    ende: integer("ende").notNull(),
    beendetAm: integer("beendet_am"),
    beendetVon: text("beendet_von"),
    endeGemeldetAm: integer("ende_gemeldet_am"),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.zugangId] }),
    index("support_zugaenge_nutzer").on(t.betreiberId, t.nutzerId, t.installationId, t.ende),
    index("support_zugaenge_beginn").on(t.betreiberId, t.beginn),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

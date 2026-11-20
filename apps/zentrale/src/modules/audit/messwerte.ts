import type { SchreibDb } from "../../db/oeffnen.ts";
import { heartbeats } from "../../db/schema.ts";

/*
 * Measurements, the one write past the audit log besides the retention's own (docs/plan.md,
 * "Audit-Log"): a heartbeat every 30 seconds per server is a reading, not an action of anyone, and
 * an audit entry for each would bury the entries that matter. Only the tables listed here; they are
 * kept 30 days (src/modules/aufbewahrung), and deleting them goes through `schreiben` again.
 */
export type Heartbeat = typeof heartbeats.$inferInsert;

/** Appends a heartbeat; a second one of the same server in the same millisecond is dropped */
export const heartbeatAnfuegen = (schreibDb: SchreibDb, zeile: Heartbeat): void => {
  schreibDb.verbindung.insert(heartbeats).values(zeile).onConflictDoNothing().run();
};

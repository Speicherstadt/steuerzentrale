import type { Db } from "../../db/oeffnen.ts";
import { betreiber } from "../../db/schema.ts";

/*
 * The Zentrale's own health for an external monitor (BAULISTE.md Z-704; docs/plan.md, "Überwachung
 * von außen"): it answers, and its database answers a read. What failed stays inside: the answer
 * carries no reason, the request needs no login.
 */
export const datenbankAntwortet = (db: Db): boolean => {
  try {
    db.select({ id: betreiber.betreiberId }).from(betreiber).limit(1).all();
    return true;
  } catch {
    return false;
  }
};

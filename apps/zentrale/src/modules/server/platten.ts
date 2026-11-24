import { type PlattenStunde, plattenProStunde, plattenVon } from "@steuerzentrale/planung";
import { Fakten } from "@steuerzentrale/protokoll";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { fakten } from "../../db/schema.ts";

/*
 * How full a server's disks were over its last days (the tab "Auslastung" of a server's page),
 * from the history of its facts (Z-304, kept 30 days): per hour the fullest reading of each mount
 * (packages/planung, plattenProStunde). Only the operator's own server's rows; a row that is not
 * a `fakten` message adds nothing.
 */

const plattenAus = (daten: string) => {
  try {
    const gelesen = Fakten.safeParse(JSON.parse(daten));
    return gelesen.success ? gelesen.data.platten : null;
  } catch {
    return null;
  }
};

export const plattenVerlauf = (
  db: Db,
  betreiberId: string,
  serverId: string,
  tage: number,
  jetzt: number,
): PlattenStunde[] =>
  plattenProStunde(
    db
      .select({ zeitpunkt: fakten.zeitpunkt, daten: fakten.daten })
      .from(fakten)
      .where(
        and(
          eq(fakten.betreiberId, betreiberId),
          eq(fakten.serverId, serverId),
          gte(fakten.zeitpunkt, plattenVon(tage, jetzt)),
        ),
      )
      .orderBy(asc(fakten.zeitpunkt))
      .all()
      .map((z) => ({ zeitpunkt: z.zeitpunkt, platten: plattenAus(z.daten) })),
  );

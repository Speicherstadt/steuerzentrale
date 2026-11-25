import { type LastStunde, lastProStunde, plattenVon } from "@steuerzentrale/planung";
import { Fakten } from "@steuerzentrale/protokoll";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { fakten } from "../../db/schema.ts";

/*
 * CPU, load and memory of a server over its last days (BAULISTE.md Z-1106; the tab "Auslastung" of
 * a server, "Messwerte" of an app), from the history of its facts, kept 30 days like the disks':
 * per hour the highest reading (packages/planung, lastProStunde). Only the operator's own server's
 * rows; a row that is not a `fakten` message, or one of an agent before Z-1106, adds nothing.
 */

const messungAus = (zeitpunkt: number, daten: string) => {
  try {
    const gelesen = Fakten.safeParse(JSON.parse(daten));
    return gelesen.success
      ? { zeitpunkt, ramMb: gelesen.data.ramMb, last: gelesen.data.last ?? null }
      : { zeitpunkt, ramMb: null, last: null };
  } catch {
    return { zeitpunkt, ramMb: null, last: null };
  }
};

export const lastVerlauf = (
  db: Db,
  betreiberId: string,
  serverId: string,
  tage: number,
  jetzt: number,
): LastStunde[] =>
  lastProStunde(
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
      .map((z) => messungAus(z.zeitpunkt, z.daten)),
  );

/** The server's hours without the values of its users */
export const serverLast = (stunden: LastStunde[]) =>
  stunden.map(({ nutzer: _, ...werte }) => werte);

/** One Linux user's hours: an installation's (`sz-<installation>`); hours without it are left out */
export const nutzerLast = (stunden: LastStunde[], name: string) =>
  stunden.flatMap((s) => {
    const n = s.nutzer[name];
    return n ? [{ stunde: s.stunde, cpuProzent: n.cpuProzent, ramMb: n.ramMb }] : [];
  });

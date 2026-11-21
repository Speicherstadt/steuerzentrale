import { type AuftragZustand, BEIM_AGENTEN } from "@steuerzentrale/protokoll";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege } from "../../db/schema.ts";

/*
 * Reading jobs (BAULISTE.md Z-305), always within one operator: a job id of another operator is
 * unknown here, whoever asks.
 */

export type Auftrag = typeof auftraege.$inferSelect;

/** The ids a job waits for */
export const vorgaengerVon = (a: Pick<Auftrag, "wartetAuf">): string[] =>
  JSON.parse(a.wartetAuf) as string[];

export const auftragLesen = (db: Db, betreiberId: string, auftragId: string): Auftrag | undefined =>
  db
    .select()
    .from(auftraege)
    .where(and(eq(auftraege.betreiberId, betreiberId), eq(auftraege.auftragId, auftragId)))
    .get();

/** The states of the operator's jobs with these ids; an id missing here is unknown */
export const zustaendeLesen = (
  db: Db,
  betreiberId: string,
  ids: readonly string[],
): Map<string, AuftragZustand> =>
  new Map(
    ids.length === 0
      ? []
      : db
          .select({ id: auftraege.auftragId, zustand: auftraege.zustand })
          .from(auftraege)
          .where(
            and(eq(auftraege.betreiberId, betreiberId), inArray(auftraege.auftragId, [...ids])),
          )
          .all()
          .map((z) => [z.id, z.zustand]),
  );

/** The operator's jobs in one state, oldest first */
export const auftraegeImZustand = (
  db: Db,
  betreiberId: string,
  zustand: AuftragZustand,
): Auftrag[] =>
  db
    .select()
    .from(auftraege)
    .where(and(eq(auftraege.betreiberId, betreiberId), eq(auftraege.zustand, zustand)))
    .orderBy(asc(auftraege.angelegtAm))
    .all();

/** A server's jobs that go to its agent when it connects: ready, or already with it */
export const offeneAuftraege = (db: Db, betreiberId: string, serverId: string): Auftrag[] =>
  db
    .select()
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, betreiberId),
        eq(auftraege.serverId, serverId),
        inArray(auftraege.zustand, ["bereit", ...BEIM_AGENTEN]),
      ),
    )
    .orderBy(asc(auftraege.angelegtAm))
    .all();

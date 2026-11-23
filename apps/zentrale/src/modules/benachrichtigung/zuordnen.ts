import { meldeSchwere, type Schwere, schwereReicht } from "@steuerzentrale/planung";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { empfaenger, ereignisse, zustellungen } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";

/*
 * Which event goes to whom (BAULISTE.md Z-703; docs/plan.md, "Benachrichtigungen"): every event of
 * an operator reaches each of its recipients whose threshold its severity meets, as one delivery in
 * the outbox. One message per fault, not per check, because the events already are one per fault
 * (Z-403 `stoerung` and `stoerung_behoben`, Z-702 one per finding). A fix (`<art>_behoben`) goes out
 * with the severity of the newest `<art>` at the same target before it, so whoever heard of the
 * fault hears of its end. Events of the last 24 hours are looked at, each delivery's id is
 * `<ereignis>.<empfaenger>`, so a second look writes nothing and an event written after a slow
 * moment is still found; a recipient gets no event older than itself.
 */
export const NACHHOLEN_MS = 24 * 3600_000;

type Ereignis = typeof ereignisse.$inferSelect;

export const BEHOBEN = "_behoben";

export const zustellungId = (ereignisId: string, empfaengerId: string) =>
  `${ereignisId}.${empfaengerId}`;

/** The newest event a fix fixes: `<art>` without `_behoben`, same target, not after it */
const behobenes = (db: Db, e: Ereignis): { schwere: string } | undefined => {
  if (!e.art.endsWith(BEHOBEN)) return undefined;
  return db
    .select({ schwere: ereignisse.schwere })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, e.betreiberId),
        eq(ereignisse.ziel, e.ziel),
        eq(ereignisse.art, e.art.slice(0, -BEHOBEN.length)),
        lte(ereignisse.zeitpunkt, e.zeitpunkt),
      ),
    )
    .orderBy(desc(ereignisse.zeitpunkt))
    .get();
};

/** The severity an event goes out with */
export const schwereFuer = (db: Db, e: Ereignis): Schwere => meldeSchwere(e, behobenes(db, e));

const vorhandene = (db: Db, betreiberId: string, ids: string[]): Set<string> =>
  new Set(
    ids.length === 0
      ? []
      : db
          .select({ id: zustellungen.zustellungId })
          .from(zustellungen)
          .where(
            and(eq(zustellungen.betreiberId, betreiberId), inArray(zustellungen.ereignisId, ids)),
          )
          .all()
          .map((z) => z.id),
  );

type Neu = typeof zustellungen.$inferInsert;

/** The deliveries one operator's events of the last 24 hours call for that do not exist yet */
const neueFuer = (db: Db, betreiberId: string, jetzt: number): Neu[] => {
  const an = db.select().from(empfaenger).where(eq(empfaenger.betreiberId, betreiberId)).all();
  if (an.length === 0) return [];
  const ab = Math.max(jetzt - NACHHOLEN_MS, Math.min(...an.map((r) => r.angelegtAm)));
  const neue = db
    .select()
    .from(ereignisse)
    .where(and(eq(ereignisse.betreiberId, betreiberId), gte(ereignisse.zeitpunkt, ab)))
    .all();
  const schon = vorhandene(
    db,
    betreiberId,
    neue.map((e) => e.ereignisId),
  );
  return neue.flatMap((e) => {
    const schwere = schwereFuer(db, e);
    return an
      .filter((r) => e.zeitpunkt >= r.angelegtAm && schwereReicht(schwere, r.abSchwere))
      .map((r) => zustellungId(e.ereignisId, r.empfaengerId))
      .filter((id) => !schon.has(id))
      .map((id) => ({
        betreiberId,
        zustellungId: id,
        ereignisId: e.ereignisId,
        empfaengerId: id.slice(e.ereignisId.length + 1),
        schwere,
        zustand: "wartet" as const,
        versuche: 0,
        faelligAm: jetzt,
        angelegtAm: jetzt,
      }));
  });
};

/** Writes the deliveries every operator's new events call for; returns how many */
export const zustellungenAnlegen = (db: Db, schreibDb: SchreibDb, jetzt: number): number => {
  const betreiberIds = new Set(
    db
      .selectDistinct({ id: empfaenger.betreiberId })
      .from(empfaenger)
      .all()
      .map((z) => z.id),
  );
  let angelegt = 0;
  for (const betreiberId of betreiberIds) {
    const neu = neueFuer(db, betreiberId, jetzt);
    if (neu.length === 0) continue;
    const kontext = { betreiberId, akteur: "system", jetzt, grund: "Ereignis zu melden" };
    schreiben(schreibDb, kontext, "benachrichtigung.anlegen", (w) => {
      for (const z of neu) w.einfuegen("zustellungen", z);
    });
    angelegt += neu.length;
  }
  return angelegt;
};

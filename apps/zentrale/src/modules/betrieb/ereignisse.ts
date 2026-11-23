import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../../db/oeffnen.ts";
import { ereignisse } from "../../db/schema.ts";
import { type Marke, type Seite, seiteBilden } from "./seite.ts";
import { type ZielVerweis, zielVerweise } from "./ziele.ts";

/*
 * The operator's events page by page (BAULISTE.md Z-406), newest first: by instant, then by id, so
 * two events of the same millisecond keep one order.
 */

export type Ereignis = Omit<typeof ereignisse.$inferSelect, "betreiberId"> & {
  /** The target's page and name, if it has one */
  verweis: ZielVerweis | null;
};

/** Each list narrows; an empty or missing one does not */
export type EreignisFilter = { schwere?: string[]; art?: string[]; ziel?: string[] };

/** The rows after the cursor, in the order (wert desc, id desc) */
export const nachMarke = (
  wert: SQLiteColumn,
  id: SQLiteColumn,
  marke: Marke | undefined,
): SQL | undefined =>
  marke === undefined
    ? undefined
    : or(lt(wert, marke.wert), and(eq(wert, marke.wert), lt(id, marke.id)));

/** `spalte` in the list, or no condition for an empty one */
export const einer = (spalte: SQLiteColumn, werte: string[] | undefined): SQL | undefined =>
  werte && werte.length > 0 ? inArray(spalte, werte) : undefined;

export const ereignisseSeite = (
  db: Db,
  betreiberId: string,
  filter: EreignisFilter,
  marke: Marke | undefined,
  groesse: number,
): Seite<Ereignis> => {
  const zeilen = db
    .select()
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, betreiberId),
        einer(ereignisse.schwere, filter.schwere),
        einer(ereignisse.art, filter.art),
        einer(ereignisse.ziel, filter.ziel),
        nachMarke(ereignisse.zeitpunkt, ereignisse.ereignisId, marke),
      ),
    )
    .orderBy(desc(ereignisse.zeitpunkt), desc(ereignisse.ereignisId))
    .limit(groesse + 1)
    .all();
  const verweise = zielVerweise(
    db,
    betreiberId,
    zeilen.map((z) => z.ziel),
  );
  return seiteBilden(
    zeilen,
    groesse,
    (e) => ({ wert: e.zeitpunkt, id: e.ereignisId }),
    ({ betreiberId: _b, ...e }) => ({ ...e, verweis: verweise.get(e.ziel) ?? null }),
  );
};

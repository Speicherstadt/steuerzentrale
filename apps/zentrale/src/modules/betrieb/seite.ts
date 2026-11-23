import { z } from "zod";

/*
 * Reading page by page (BAULISTE.md Z-406; docs/plan.md, "Seitenweise lesen"): newest first, the
 * cursor names the last row of the page before (its instant or number and its id), never an offset.
 * Rows that arrive between two pages are newer than the cursor and so never push a row of the next
 * page onto one already read: every row comes exactly once.
 */

/** How many rows a page holds when the request names no number, and at most */
export const SEITE_VORGABE = 50;
export const SEITE_MAX = 200;

/** Where the next page starts: after the row with this sort value and id */
export type Marke = { wert: number; id: string };

const markeSchema = z.tuple([z.number().int(), z.string().max(200)]);

/** The cursor as the API hands it out: opaque, URL-safe */
export const markeSchreiben = (m: Marke): string =>
  Buffer.from(JSON.stringify([m.wert, m.id])).toString("base64url");

/** The cursor of a request, or an error for one the Zentrale did not hand out */
export const markeLesen = (
  text: string | undefined,
): { ok: true; marke: Marke | undefined } | { ok: false } => {
  if (text === undefined || text === "") return { ok: true, marke: undefined };
  try {
    const geparst = markeSchema.safeParse(
      JSON.parse(Buffer.from(text, "base64url").toString("utf8")),
    );
    return geparst.success
      ? { ok: true, marke: { wert: geparst.data[0], id: geparst.data[1] } }
      : { ok: false };
  } catch {
    return { ok: false };
  }
};

/** The page size of a request: a whole number from 1 to SEITE_MAX, else the default */
export const groesseLesen = (text: string | undefined): number | undefined => {
  if (text === undefined || text === "") return SEITE_VORGABE;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= SEITE_MAX ? n : undefined;
};

export type Seite<T> = { eintraege: T[]; weiter: string | null };

/**
 * One page from rows read with one more than asked: that extra row only says whether there is a
 * next page; the cursor is the last row shown
 */
export const seiteBilden = <Z, T>(
  zeilen: Z[],
  groesse: number,
  marke: (z: Z) => Marke,
  zeigen: (z: Z) => T,
): Seite<T> => {
  const sichtbar = zeilen.slice(0, groesse);
  const letzte = sichtbar.at(-1);
  return {
    eintraege: sichtbar.map(zeigen),
    weiter: zeilen.length > groesse && letzte ? markeSchreiben(marke(letzte)) : null,
  };
};

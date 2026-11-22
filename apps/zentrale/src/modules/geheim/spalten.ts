import type { Schluesselbund } from "../../db/schluessel.ts";
import { type TabellenName, tabellen } from "../audit/tabellen.ts";
import { type Entschluesselt, entschluesseln, verschluesseln } from "./verschluesseln.ts";

/*
 * The encrypted columns of every table (modules/audit/tabellen.ts, `verschluesselteSpalten`): a
 * value is bound to its table, operator and row by the key columns, so a ciphertext copied into
 * another row or another operator's does not open.
 */

/** "<table>:<operator>:<key columns…>", e.g. "geheimnisse:b1:s3" */
export const spaltenZweck = (
  name: TabellenName,
  betreiberId: string,
  zeile: Readonly<Record<string, unknown>>,
): string =>
  [name, betreiberId, ...tabellen[name].schluessel.map((feld) => String(zeile[feld]))].join(":");

/** A value for an encrypted column of the row named by `zeile`, with the current key */
export const spalteVerschluesseln = (
  bund: Schluesselbund,
  name: TabellenName,
  betreiberId: string,
  zeile: Readonly<Record<string, unknown>>,
  klartext: string,
): string => verschluesseln(bund.aktuell, spaltenZweck(name, betreiberId, zeile), klartext);

/** The plain text of an encrypted column, with whichever key of the bunch it names */
export const spalteEntschluesseln = (
  bund: Schluesselbund,
  name: TabellenName,
  betreiberId: string,
  zeile: Readonly<Record<string, unknown>>,
  wert: string,
): Entschluesselt =>
  entschluesseln([bund.aktuell, ...bund.alt], spaltenZweck(name, betreiberId, zeile), wert);

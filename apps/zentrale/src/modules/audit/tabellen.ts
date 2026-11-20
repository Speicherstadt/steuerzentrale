import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  betreiber,
  ereignisse,
  geheimnisse,
  heartbeats,
  logAuszuege,
  tokens,
} from "../../db/schema.ts";

/**
 * The tables `schreiben` may write, with the columns that name one row besides `betreiber_id`, and
 * the column the retention run (src/modules/aufbewahrung) deletes by. A table missing here cannot be
 * written through the audit log; the audit log itself is not here: it is only appended to.
 */
export const tabellen = {
  betreiber: { tabelle: betreiber, schluessel: [] as string[], zeit: undefined },
  logAuszuege: { tabelle: logAuszuege, schluessel: ["auszugId"], zeit: logAuszuege.zeitpunkt },
  ereignisse: { tabelle: ereignisse, schluessel: ["ereignisId"], zeit: ereignisse.zeitpunkt },
  geheimnisse: { tabelle: geheimnisse, schluessel: ["geheimnisId"], zeit: undefined },
  tokens: { tabelle: tokens, schluessel: ["tokenId"], zeit: undefined },
  heartbeats: {
    tabelle: heartbeats,
    schluessel: ["serverId", "zeitpunkt"],
    zeit: heartbeats.zeitpunkt,
  },
} satisfies Record<
  string,
  { tabelle: SQLiteTable; schluessel: string[]; zeit: SQLiteColumn | undefined }
>;

export type TabellenName = keyof typeof tabellen;
export type Tabelle<N extends TabellenName> = (typeof tabellen)[N]["tabelle"];

/** The tables with a column the retention run deletes by */
export type AufbewahrteTabelle = {
  [N in TabellenName]: (typeof tabellen)[N]["zeit"] extends SQLiteColumn ? N : never;
}[TabellenName];

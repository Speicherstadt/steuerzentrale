import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  appEinstellungen,
  auftraege,
  betreiber,
  einladungen,
  ereignisse,
  fakten,
  geheimnisse,
  heartbeats,
  installationen,
  installationsPorts,
  installationVerlauf,
  kunden,
  logAuszuege,
  mitglieder,
  server,
  tokens,
  vertraege,
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
  mitglieder: { tabelle: mitglieder, schluessel: ["nutzerId"], zeit: undefined },
  einladungen: { tabelle: einladungen, schluessel: ["einladungId"], zeit: undefined },
  kunden: { tabelle: kunden, schluessel: ["kundeId"], zeit: undefined },
  vertraege: { tabelle: vertraege, schluessel: ["vertragId"], zeit: undefined },
  server: { tabelle: server, schluessel: ["serverId"], zeit: undefined },
  heartbeats: {
    tabelle: heartbeats,
    schluessel: ["serverId", "zeitpunkt"],
    zeit: heartbeats.zeitpunkt,
  },
  fakten: { tabelle: fakten, schluessel: ["serverId", "zeitpunkt"], zeit: fakten.zeitpunkt },
  auftraege: { tabelle: auftraege, schluessel: ["auftragId"], zeit: undefined },
  installationen: { tabelle: installationen, schluessel: ["installationId"], zeit: undefined },
  installationVerlauf: {
    tabelle: installationVerlauf,
    schluessel: ["installationId", "zeitpunkt"],
    zeit: installationVerlauf.zeitpunkt,
  },
  installationsPorts: {
    tabelle: installationsPorts,
    schluessel: ["serverId", "port"],
    zeit: undefined,
  },
  appEinstellungen: { tabelle: appEinstellungen, schluessel: ["app", "name"], zeit: undefined },
} satisfies Record<
  string,
  { tabelle: SQLiteTable; schluessel: string[]; zeit: SQLiteColumn | undefined }
>;

export type TabellenName = keyof typeof tabellen;

/**
 * Encrypted columns, which the append-only audit log records only as changed: a ciphertext kept
 * there forever would still open with a key that was rotated away because it leaked
 */
export const verschluesselteSpalten: Partial<Record<TabellenName, readonly string[]>> = {
  geheimnisse: ["wert"],
  installationen: ["geheim"],
  appEinstellungen: ["wertVerschluesselt"],
};
/**
 * Columns the audit log records only as set: a job's manifest text and signature (Z-305) would put
 * the same kilobytes into the append-only log with every job; its hash stands in the row
 */
export const ausgelasseneSpalten: Partial<Record<TabellenName, readonly string[]>> = {
  auftraege: ["manifest", "signatur"],
  installationen: ["manifest", "signatur"],
};
export type Tabelle<N extends TabellenName> = (typeof tabellen)[N]["tabelle"];

/** The tables with a column the retention run deletes by */
export type AufbewahrteTabelle = {
  [N in TabellenName]: (typeof tabellen)[N]["zeit"] extends SQLiteColumn ? N : never;
}[TabellenName];

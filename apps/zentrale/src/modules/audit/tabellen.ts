import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  appEinstellungen,
  auftraege,
  backups,
  backupZiele,
  backupZugaenge,
  benachrichtigungEinstellungen,
  betreiber,
  dnsEinstellungen,
  einladungen,
  empfaenger,
  ereignisse,
  fakten,
  geheimnisse,
  heartbeats,
  installationen,
  installationKonfigurationen,
  installationsPorts,
  installationVerlauf,
  kunden,
  logAuszuege,
  manifeste,
  mitglieder,
  pruefRestores,
  server,
  tokens,
  updates,
  vertraege,
  wiederherstellungen,
  zustellungen,
} from "../../db/schema.ts";

/**
 * The tables `schreiben` may write, with the columns that name one row besides `betreiber_id`, and
 * the column the retention run (src/modules/aufbewahrung) deletes by. A table missing here cannot be
 * written through the audit log; the audit log itself is not here: it is only appended to. A
 * `global` table holds no operator's data and has no `betreiber_id` (the imported manifests, Z-501):
 * its row is not bound to the writer's operator, the entry still goes into the writer's audit log.
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
  installationKonfigurationen: {
    tabelle: installationKonfigurationen,
    schluessel: ["auftragId"],
    zeit: undefined,
  },
  dnsEinstellungen: { tabelle: dnsEinstellungen, schluessel: [] as string[], zeit: undefined },
  backupZiele: { tabelle: backupZiele, schluessel: [] as string[], zeit: undefined },
  backupZugaenge: { tabelle: backupZugaenge, schluessel: ["installationId"], zeit: undefined },
  backups: { tabelle: backups, schluessel: ["backupId"], zeit: backups.zeitpunkt },
  pruefRestores: {
    tabelle: pruefRestores,
    schluessel: ["auftragId"],
    zeit: pruefRestores.zeitpunkt,
  },
  wiederherstellungen: {
    tabelle: wiederherstellungen,
    schluessel: ["auftragId"],
    zeit: undefined,
  },
  updates: { tabelle: updates, schluessel: ["auftragId"], zeit: undefined },
  manifeste: { tabelle: manifeste, schluessel: ["app", "version"], zeit: undefined, global: true },
  benachrichtigungEinstellungen: {
    tabelle: benachrichtigungEinstellungen,
    schluessel: [] as string[],
    zeit: undefined,
  },
  empfaenger: { tabelle: empfaenger, schluessel: ["empfaengerId"], zeit: undefined },
  zustellungen: {
    tabelle: zustellungen,
    schluessel: ["zustellungId"],
    zeit: zustellungen.angelegtAm,
  },
} satisfies Record<
  string,
  { tabelle: SQLiteTable; schluessel: string[]; zeit: SQLiteColumn | undefined; global?: true }
>;

export type TabellenName = keyof typeof tabellen;

/** Whether a table holds no operator's data (`global`), so its rows carry no `betreiber_id` */
export const istGlobal = (name: TabellenName): boolean =>
  (tabellen[name] as { global?: true }).global === true;

/**
 * Encrypted columns, which the append-only audit log records only as changed: a ciphertext kept
 * there forever would still open with a key that was rotated away because it leaked
 */
export const verschluesselteSpalten: Partial<Record<TabellenName, readonly string[]>> = {
  geheimnisse: ["wert"],
  installationen: ["geheim"],
  appEinstellungen: ["wertVerschluesselt"],
  installationKonfigurationen: ["geheim"],
  backupZugaenge: ["geheim"],
  empfaenger: ["geheim"],
};
/**
 * Columns the audit log records only as set: a job's manifest text and signature (Z-305) would put
 * the same kilobytes into the append-only log with every job; its hash stands in the row, as in an
 * imported manifest (Z-501). The lines
 * of a log excerpt (Z-405) hold the customers' data and go after 30 days; the audit log stays.
 */
export const ausgelasseneSpalten: Partial<Record<TabellenName, readonly string[]>> = {
  logAuszuege: ["inhalt"],
  auftraege: ["manifest", "signatur"],
  installationen: ["manifest", "signatur"],
  manifeste: ["text", "signatur"],
};
export type Tabelle<N extends TabellenName> = (typeof tabellen)[N]["tabelle"];

/** The tables with a column the retention run deletes by */
export type AufbewahrteTabelle = {
  [N in TabellenName]: (typeof tabellen)[N]["zeit"] extends SQLiteColumn ? N : never;
}[TabellenName];

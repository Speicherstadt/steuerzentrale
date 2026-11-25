import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { kunden, server } from "./schema.ts";

/*
 * The tables of installations (BAULISTE.md Z-402; docs/plan.md, "Installationen in der Zentrale"),
 * re-exported by schema.ts; each carries betreiber_id like every table with an operator's data.
 */

/** Where an installation stands (docs/plan.md, "Installationen in der Zentrale") */
export const INSTALLATIONS_ZUSTAENDE = [
  "wird_eingerichtet",
  "laeuft",
  "gescheitert",
  "entfernt",
] as const;

/**
 * Where an installation's DNS records stand (Z-407; docs/plan.md, "DNS über Cloudflare"): to be set,
 * set, to be deleted, deleted. Null for a host the Zentrale sets no records for (not below the
 * operator's domain when the installation was made)
 */
export const DNS_ZUSTAENDE = ["setzen", "gesetzt", "loeschen", "geloescht"] as const;

/** The rating of an installation (packages/planung, `installationBewerten`) */
export const BEWERTUNGEN = ["gruen", "gelb", "rot", "unbekannt"] as const;

/**
 * An installation of an app for a customer on a server (BAULISTE.md Z-402). `installation_id` is its
 * name (`<app>-<6 characters>`), the prefix of its units and its Linux user `sz-<name>`. Until
 * manifests are imported (Z-501) it keeps the signed manifest's text and signature. `ports` is JSON
 * `{ "<dienst>:<port>": port }` of the assigned ports besides `http_port`, `optionen` a JSON list,
 * `einstellungen` JSON `{ betreiber, installation }` of the values that are not secret, as they were
 * when it was made, `ipv4` the server's public IPv4 then. `geheim` is encrypted
 * (src/modules/geheim): JSON `{ betreiber, installation, auto }` of the secret values and the
 * generated `auto` values; it leaves the Zentrale only in the setup job to the agent. The host is
 * unique among the operator's installations not removed. Its current rating (Z-403) is a
 * measurement written only by modules/audit/messwerte.ts: `bewertung`, `bewertung_grund` (JSON
 * `{ code, werte }`), `bewertung_seit`, `gemeldet_am` (the last report) and `meldung` (JSON units and
 * health of that report); null until the agent first reports. `dns` is where its DNS records stand
 * (Z-407, `DNS_ZUSTAENDE`), with the failed attempts since the last success and when the next is
 * due (backoff), written by modules/dns.
 */
export const installationen = sqliteTable(
  "installationen",
  {
    betreiberId: text("betreiber_id").notNull(),
    installationId: text("installation_id").notNull(),
    kundeId: text("kunde_id").notNull(),
    serverId: text("server_id").notNull(),
    app: text("app").notNull(),
    version: text("version").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    manifest: text("manifest").notNull(),
    signatur: text("signatur").notNull(),
    host: text("host").notNull(),
    ipv4: text("ipv4"),
    httpPort: integer("http_port"),
    ports: text("ports").notNull(),
    optionen: text("optionen").notNull(),
    einstellungen: text("einstellungen").notNull(),
    geheim: text("geheim").notNull(),
    zustand: text("zustand", { enum: INSTALLATIONS_ZUSTAENDE }).notNull(),
    bewertung: text("bewertung", { enum: BEWERTUNGEN }),
    bewertungGrund: text("bewertung_grund"),
    bewertungSeit: integer("bewertung_seit"),
    gemeldetAm: integer("gemeldet_am"),
    meldung: text("meldung"),
    dns: text("dns", { enum: DNS_ZUSTAENDE }),
    dnsVersuche: integer("dns_versuche").notNull().default(0),
    dnsNaechsterVersuch: integer("dns_naechster_versuch"),
    angelegtVon: text("angelegt_von").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
    geaendertAm: integer("geaendert_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.installationId] }),
    index("installationen_server").on(t.betreiberId, t.serverId),
    index("installationen_dns").on(t.dnsNaechsterVersuch),
    uniqueIndex("installationen_host")
      .on(t.betreiberId, t.host)
      // a literal: drizzle-kit writes a bound value here, which SQLite refuses in an index
      .where(sql`${t.zustand} <> 'entfernt'`),
    foreignKey({
      columns: [t.betreiberId, t.serverId],
      foreignColumns: [server.betreiberId, server.serverId],
    }),
    foreignKey({
      columns: [t.betreiberId, t.kundeId],
      foreignColumns: [kunden.betreiberId, kunden.kundeId],
    }),
  ],
);

/**
 * Every change of an installation's rating (Z-403; docs/plan.md, "Zustand in der Zentrale"), with
 * its reason as JSON `{ code, werte }`; a measurement like the rating itself, kept 90 days
 * (src/modules/aufbewahrung).
 */
export const installationVerlauf = sqliteTable(
  "installation_verlauf",
  {
    betreiberId: text("betreiber_id").notNull(),
    installationId: text("installation_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    bewertung: text("bewertung", { enum: BEWERTUNGEN }).notNull(),
    grund: text("grund").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.installationId, t.zeitpunkt] }),
    index("installation_verlauf_zeitpunkt").on(t.zeitpunkt),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

/**
 * A host port the Zentrale assigned on a server (20000-29999), one row per port, also for each port
 * of a range: the primary key keeps a port unique on its server, whatever two requests race for it.
 * `zweck` is `http` or `<dienst>:<port>` of the manifest. Removed with its installation.
 */
export const installationsPorts = sqliteTable(
  "installations_ports",
  {
    betreiberId: text("betreiber_id").notNull(),
    serverId: text("server_id").notNull(),
    port: integer("port").notNull(),
    installationId: text("installation_id").notNull(),
    zweck: text("zweck").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.serverId, t.port] }),
    index("installations_ports_installation").on(t.betreiberId, t.installationId),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

/**
 * A value of an operator for one app (level `betreiber` of its manifest; docs/plan.md,
 * "Einstellungen des Betreibers"): JSON in `wert`, or for a secret one encrypted in
 * `wert_verschluesselt` with `wert` null. Written with Z-404; installing only reads it.
 */
export const appEinstellungen = sqliteTable(
  "app_einstellungen",
  {
    betreiberId: text("betreiber_id").notNull(),
    app: text("app").notNull(),
    name: text("name").notNull(),
    wert: text("wert"),
    wertVerschluesselt: text("wert_verschluesselt"),
    geaendertAm: integer("geaendert_am").notNull(),
  },
  (t) => [primaryKey({ columns: [t.betreiberId, t.app, t.name] })],
);

/**
 * The values asked for by "Einstellungen ändern" (BAULISTE.md Z-404; docs/plan.md, "Neu
 * konfigurieren"), one row per open job `installation_konfigurieren`: `einstellungen` JSON
 * `{ betreiber, installation }` of the values that are not secret, `geheim` encrypted JSON
 * `{ betreiber, installation, auto }` like the installation's own column. The installation keeps
 * the values it runs with until the job succeeded; then these replace them, and the row goes
 * whatever the job's end, so no secret it held stays behind.
 */
export const installationKonfigurationen = sqliteTable(
  "installation_konfigurationen",
  {
    betreiberId: text("betreiber_id").notNull(),
    auftragId: text("auftrag_id").notNull(),
    installationId: text("installation_id").notNull(),
    einstellungen: text("einstellungen").notNull(),
    geheim: text("geheim").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.auftragId] }),
    index("installation_konfigurationen_installation").on(t.betreiberId, t.installationId),
    foreignKey({
      columns: [t.betreiberId, t.installationId],
      foreignColumns: [installationen.betreiberId, installationen.installationId],
    }),
  ],
);

/**
 * The operator's DNS at Cloudflare (Z-407; docs/plan.md, "DNS über Cloudflare"): its domain (the
 * addresses `<app>.<kuerzel>.<domain>`) and the id of the zone that holds it. The API token is a
 * secret of the operator in `geheimnisse` (modules/dns/einstellungen.ts), never in this row.
 */
export const dnsEinstellungen = sqliteTable("dns_einstellungen", {
  betreiberId: text("betreiber_id").primaryKey(),
  domain: text("domain").notNull(),
  zoneId: text("zone_id").notNull(),
  geaendertAm: integer("geaendert_am").notNull(),
});

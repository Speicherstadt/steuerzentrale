import { AUFTRAG_ZUSTAENDE } from "@steuerzentrale/protokoll";
import { ne } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * The tables of the Zentrale. Every table with data of an operator carries `betreiber_id`
 * (docs/plan.md, "Mandanten"); exempt are only manifests and Better Auth's tables (later items) and
 * the migrations' own bookkeeping (src/db/migrieren.ts). Instants are UTC milliseconds.
 */

/**
 * An operator; partners are operators too (docs/plan.md, "Partner"). `betreiber_id` is the id of
 * the operator's organization in Better Auth (docs/plan.md, "Anmeldung an der Zentrale")
 */
export const betreiber = sqliteTable("betreiber", {
  betreiberId: text("betreiber_id").primaryKey(),
  name: text("name").notNull(),
  angelegtAm: integer("angelegt_am").notNull(),
});

/** Append-only (triggers in the migration): who did what to which target, when and why */
export const auditLog = sqliteTable(
  "audit_log",
  {
    nummer: integer("nummer").primaryKey({ autoIncrement: true }),
    betreiberId: text("betreiber_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    akteur: text("akteur").notNull(),
    aktion: text("aktion").notNull(),
    ziel: text("ziel").notNull(),
    grund: text("grund").notNull(),
    inhalt: text("inhalt").notNull(),
  },
  (t) => [index("audit_log_betreiber").on(t.betreiberId, t.zeitpunkt)],
);

/** One heartbeat of a server's agent (Z-303); kept 30 days (docs/plan.md, "Daten der Zentrale") */
export const heartbeats = sqliteTable(
  "heartbeats",
  {
    betreiberId: text("betreiber_id").notNull(),
    serverId: text("server_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    daten: text("daten").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.serverId, t.zeitpunkt] }),
    index("heartbeats_zeitpunkt").on(t.zeitpunkt),
  ],
);

/**
 * The facts a server's agent reported (Z-304), every 15 minutes: the history, kept 30 days
 * (docs/plan.md, "Daten der Zentrale"). `daten` is the `fakten` message as JSON; the newest also
 * stands at the server (`server.fakten`)
 */
export const fakten = sqliteTable(
  "fakten",
  {
    betreiberId: text("betreiber_id").notNull(),
    serverId: text("server_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    daten: text("daten").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.serverId, t.zeitpunkt] }),
    index("fakten_zeitpunkt").on(t.zeitpunkt),
  ],
);

/** A log excerpt in a job (Z-405); holds customer data, kept 30 days */
export const logAuszuege = sqliteTable(
  "log_auszuege",
  {
    betreiberId: text("betreiber_id").notNull(),
    auszugId: text("auszug_id").notNull(),
    auftragId: text("auftrag_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    inhalt: text("inhalt").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.auszugId] }),
    index("log_auszuege_zeitpunkt").on(t.zeitpunkt),
  ],
);

/** Something that happened (a failure, an SSH login, a deletion record); kept 13 months */
export const ereignisse = sqliteTable(
  "ereignisse",
  {
    betreiberId: text("betreiber_id").notNull(),
    ereignisId: text("ereignis_id").notNull(),
    zeitpunkt: integer("zeitpunkt").notNull(),
    art: text("art").notNull(),
    schwere: text("schwere").notNull(),
    ziel: text("ziel").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.ereignisId] }),
    index("ereignisse_zeitpunkt").on(t.zeitpunkt),
  ],
);

/**
 * A secret of an operator (S3 key, restic password, an `auto` value of an installation), encrypted
 * with STEUERZENTRALE_SECRET_KEY (src/modules/geheim); `wert` never holds plain text
 */
export const geheimnisse = sqliteTable(
  "geheimnisse",
  {
    betreiberId: text("betreiber_id").notNull(),
    geheimnisId: text("geheimnis_id").notNull(),
    zweck: text("zweck").notNull(),
    wert: text("wert").notNull(),
    geaendertAm: integer("geaendert_am").notNull(),
  },
  (t) => [primaryKey({ columns: [t.betreiberId, t.geheimnisId] })],
);

/**
 * A token stored only as its SHA-256 (join tokens of servers, later API tokens): whoever reads the
 * database cannot use it
 */
export const tokens = sqliteTable(
  "tokens",
  {
    betreiberId: text("betreiber_id").notNull(),
    tokenId: text("token_id").notNull(),
    zweck: text("zweck").notNull(),
    hash: text("hash").notNull().unique(),
    gueltigBis: integer("gueltig_bis"),
    angelegtAm: integer("angelegt_am").notNull(),
  },
  (t) => [primaryKey({ columns: [t.betreiberId, t.tokenId] })],
);

/**
 * A person's membership of an operator with its role (inhaber, technik, support): the mirror of
 * Better Auth's `member`, written through `schreiben`, so every membership and role change stands in
 * the audit log; the routes read the role from here (src/routes/zugang.ts)
 */
export const mitglieder = sqliteTable(
  "mitglieder",
  {
    betreiberId: text("betreiber_id").notNull(),
    nutzerId: text("nutzer_id").notNull(),
    rolle: text("rolle").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.nutzerId] }),
    index("mitglieder_nutzer").on(t.nutzerId),
  ],
);

/**
 * An invitation by link into an operator with a role; its token is a row in `tokens` with the same
 * id (only the hash), removed when the invitation is accepted or withdrawn
 */
export const einladungen = sqliteTable(
  "einladungen",
  {
    betreiberId: text("betreiber_id").notNull(),
    einladungId: text("einladung_id").notNull(),
    rolle: text("rolle").notNull(),
    gueltigBis: integer("gueltig_bis").notNull(),
    angelegtVon: text("angelegt_von").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
    angenommenVon: text("angenommen_von"),
    angenommenAm: integer("angenommen_am"),
  },
  (t) => [primaryKey({ columns: [t.betreiberId, t.einladungId] })],
);

/**
 * A customer of an operator with one contact person (BAULISTE.md Z-801); customers never sign in
 * to the Zentrale (docs/plan.md, "Was der Kunde sieht")
 */
export const kunden = sqliteTable(
  "kunden",
  {
    betreiberId: text("betreiber_id").notNull(),
    kundeId: text("kunde_id").notNull(),
    name: text("name").notNull(),
    kontaktName: text("kontakt_name").notNull(),
    kontaktEmail: text("kontakt_email").notNull(),
    kontaktTelefon: text("kontakt_telefon"),
    notiz: text("notiz"),
    angelegtAm: integer("angelegt_am").notNull(),
  },
  (t) => [primaryKey({ columns: [t.betreiberId, t.kundeId] })],
);

/** The service levels of a contract (docs/plan.md, "SLA"); stage 1 offers only `basis` (Z-505) */
export const SLAS = ["basis", "plus", "ruhe"] as const;

/**
 * A customer's contract with its SLA, the day it begins and, once the customer gave notice, the day
 * it ends (docs/plan.md, "Kündigung und Löschung"); in stage 1 one per customer, made with it
 */
export const vertraege = sqliteTable(
  "vertraege",
  {
    betreiberId: text("betreiber_id").notNull(),
    vertragId: text("vertrag_id").notNull(),
    kundeId: text("kunde_id").notNull(),
    sla: text("sla", { enum: SLAS }).notNull(),
    beginn: integer("beginn").notNull(),
    ende: integer("ende"),
    angelegtAm: integer("angelegt_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.vertragId] }),
    uniqueIndex("vertraege_kunde").on(t.betreiberId, t.kundeId),
    foreignKey({
      columns: [t.betreiberId, t.kundeId],
      foreignColumns: [kunden.betreiberId, kunden.kundeId],
    }),
  ],
);

/**
 * A managed server (BAULISTE.md Z-302): shared by several customers, of one customer, or at the
 * customer (`kunde_id` for the last two). Its agent joins once with a one-time token (a row in
 * `tokens` with the server's id, only the hash) and from then on is known by the SHA-256 fingerprint
 * of its client certificate; the certificate itself stays on the server. A revoked server is refused
 * whatever certificate it shows, and comes back only when added anew. `wartungsfenster` is JSON
 * `{ tage, von, bis }` in Europe/Berlin (packages/planung, Wartungsfenster).
 */
export const server = sqliteTable(
  "server",
  {
    betreiberId: text("betreiber_id").notNull(),
    serverId: text("server_id").notNull(),
    name: text("name").notNull(),
    art: text("art").notNull(),
    kundeId: text("kunde_id"),
    wartungsfenster: text("wartungsfenster").notNull(),
    fingerabdruck: text("fingerabdruck").unique(),
    zertifikatGueltigBis: integer("zertifikat_gueltig_bis"),
    // A rotated certificate (Z-303) the agent has not connected with yet: both are accepted until
    // it does, so an agent that lost the answer keeps its way in with the old one
    fingerabdruckNeu: text("fingerabdruck_neu").unique(),
    zertifikatNeuGueltigBis: integer("zertifikat_neu_gueltig_bis"),
    // Revoked (Z-303): no fingerprint of the server is accepted any more
    gesperrtAm: integer("gesperrt_am"),
    beigetretenAm: integer("beigetreten_am"),
    architektur: text("architektur"),
    agentVersion: text("agent_version"),
    // The newest facts (Z-304), the `fakten` message as JSON, and when the Zentrale got them; a
    // measurement like the rows in `fakten`, written only by modules/audit/messwerte.ts
    fakten: text("fakten"),
    faktenAm: integer("fakten_am"),
    angelegtVon: text("angelegt_von").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
  },
  (t) => [primaryKey({ columns: [t.betreiberId, t.serverId] })],
);

/**
 * A job for a server's agent (BAULISTE.md Z-305): the name of a command in a signed manifest with
 * its arguments, never a command line. Until manifests are imported (Z-501) the job carries the
 * manifest's exact text and signature, with app, version and SHA-256 of the text; the agent checks
 * the signature itself. `wartet_auf` is a JSON list of job ids of the same operator, on any server;
 * `argumente` and `ergebnis` are JSON. `fortschritt` is the agent's last step, a measurement
 * written past the audit log (modules/audit/messwerte.ts); every change of `zustand` goes through
 * `schreiben`. Log excerpts of a job stand in `log_auszuege` (30 days).
 */
export const auftraege = sqliteTable(
  "auftraege",
  {
    betreiberId: text("betreiber_id").notNull(),
    auftragId: text("auftrag_id").notNull(),
    serverId: text("server_id").notNull(),
    installationId: text("installation_id"),
    aktion: text("aktion").notNull(),
    app: text("app").notNull(),
    version: text("version").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    manifest: text("manifest").notNull(),
    signatur: text("signatur").notNull(),
    argumente: text("argumente").notNull(),
    zeitlimitS: integer("zeitlimit_s").notNull(),
    zustand: text("zustand", { enum: AUFTRAG_ZUSTAENDE }).notNull(),
    wartetAuf: text("wartet_auf").notNull(),
    fortschritt: text("fortschritt"),
    fortschrittAm: integer("fortschritt_am"),
    ergebnis: text("ergebnis"),
    angelegtVon: text("angelegt_von").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
    geaendertAm: integer("geaendert_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.auftragId] }),
    index("auftraege_server").on(t.betreiberId, t.serverId, t.zustand),
    index("auftraege_zustand").on(t.betreiberId, t.zustand),
    foreignKey({
      columns: [t.betreiberId, t.serverId],
      foreignColumns: [server.betreiberId, server.serverId],
    }),
  ],
);

/** Where an installation stands (docs/plan.md, "Installationen in der Zentrale") */
export const INSTALLATIONS_ZUSTAENDE = [
  "wird_eingerichtet",
  "laeuft",
  "gescheitert",
  "entfernt",
] as const;

/**
 * An installation of an app for a customer on a server (BAULISTE.md Z-402). `installation_id` is its
 * name (`<app>-<6 characters>`), the prefix of its units and its Linux user `sz-<name>`. Until
 * manifests are imported (Z-501) it keeps the signed manifest's text and signature. `ports` is JSON
 * `{ "<dienst>:<port>": port }` of the assigned ports besides `http_port`, `optionen` a JSON list,
 * `einstellungen` JSON `{ betreiber, installation }` of the values that are not secret, as they were
 * when it was made, `ipv4` the server's public IPv4 then. `geheim` is encrypted
 * (src/modules/geheim): JSON `{ betreiber, installation, auto }` of the secret values and the
 * generated `auto` values; it leaves the Zentrale only in the setup job to the agent. The host is
 * unique among the operator's installations not removed.
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
    angelegtVon: text("angelegt_von").notNull(),
    angelegtAm: integer("angelegt_am").notNull(),
    geaendertAm: integer("geaendert_am").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.installationId] }),
    index("installationen_server").on(t.betreiberId, t.serverId),
    uniqueIndex("installationen_host").on(t.betreiberId, t.host).where(ne(t.zustand, "entfernt")),
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

import { z } from "zod";
import { pem } from "./pem.ts";

/*
 * The messages between the Zentrale and the agent over the WebSocket (docs/plan.md, "Verbindung"),
 * shared by both so they cannot drift apart. Every message is a JSON object with `typ` and the
 * protocol version `protokoll` of its sender. A job names a manifest action and its arguments, never
 * a command (CLAUDE.md, "Project specifics"); it carries the manifest and its signature, which the
 * agent checks itself.
 */

const id = z.string().min(1).max(200);
const zeitpunkt = z.number().int().nonnegative();
const protokoll = z.number().int().positive();

const architektur = z.enum(["amd64", "arm64"]);

// Agent → Zentrale

export const Hallo = z.object({
  typ: z.literal("hallo"),
  protokoll,
  agentVersion: z.string().min(1),
  architektur,
  zeit: zeitpunkt,
});

export const Heartbeat = z.object({ typ: z.literal("heartbeat"), protokoll, zeit: zeitpunkt });

const platte = z.object({
  mount: z.string().min(1),
  gesamtMb: z.number().nonnegative(),
  freiMb: z.number().nonnegative(),
});

/**
 * What the agent reads from its server (Z-304), at connecting and then every 15 minutes
 * (FAKTEN_MS). A fact the agent cannot read is null, never invented: a list that is null was not
 * readable, an empty one was read and holds nothing. `ptr` names only the addresses that have one.
 */
export const Fakten = z.object({
  typ: z.literal("fakten"),
  protokoll,
  zeit: zeitpunkt,
  cpuKerne: z.number().int().positive().nullable(),
  ramMb: z.number().int().positive().nullable(),
  platten: z.array(platte).max(200).nullable(),
  architektur: architektur.nullable(),
  os: z.object({ name: z.string(), version: z.string() }).nullable(),
  kernel: z.object({ laeuft: z.string().nullable(), installiert: z.string().nullable() }),
  neustartNoetig: z.boolean().nullable(),
  updatesAusstehend: z.number().int().nonnegative().nullable(),
  podman: z.string().nullable(),
  ipv4: z.array(z.string()).max(200).nullable(),
  ipv6: z.array(z.string()).max(200).nullable(),
  ptr: z.record(z.string(), z.string()),
  portsBelegt: z
    .array(z.object({ port: z.number().int().min(1).max(65535), proto: z.enum(["tcp", "udp"]) }))
    .max(10_000)
    .nullable(),
  port25Ausgehend: z.boolean().nullable(),
  uhrzeitAbweichungMs: z.number().int().nullable(),
});

// The ActiveState values of systemd (`systemctl --state=help`; "refreshing" since systemd 257),
// plus "unknown" for a unit the agent cannot read
const unit = z.object({
  name: z.string().min(1),
  aktiv: z.enum([
    "active",
    "reloading",
    "inactive",
    "failed",
    "activating",
    "deactivating",
    "maintenance",
    "refreshing",
    "unknown",
  ]),
});
const health = z.object({
  zustand: z.enum(["gruen", "gelb", "rot", "unbekannt"]),
  grund: z.string(),
});

export const Zustand = z.object({
  typ: z.literal("zustand"),
  protokoll,
  zeit: zeitpunkt,
  installationen: z.array(z.object({ installationId: id, units: z.array(unit), health })),
});

export const Bestaetigt = z.object({ typ: z.literal("bestaetigt"), protokoll, auftragId: id });

export const Fortschritt = z.object({
  typ: z.literal("fortschritt"),
  protokoll,
  auftragId: id,
  schritt: z.string().min(1).max(200),
  zeit: zeitpunkt,
});

export const Ergebnis = z.object({
  typ: z.literal("ergebnis"),
  protokoll,
  auftragId: id,
  zeit: zeitpunkt,
  ergebnis: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), daten: z.record(z.string(), z.unknown()).default({}) }),
    z.object({ ok: z.literal(false), fehler: z.string().min(1).max(2000) }),
  ]),
});

/** At most 500 lines (Z-405), values of the installation's secrets already replaced by the agent */
export const LogAuszug = z.object({
  typ: z.literal("log_auszug"),
  protokoll,
  auftragId: id,
  zeilen: z.array(z.string()).max(500),
});

/** An accepted SSH login from the journal (Z-304, docs/plan.md "Notzugang"), at its own time */
export const SshAnmeldung = z.object({
  typ: z.literal("ssh_anmeldung"),
  protokoll,
  zeit: zeitpunkt,
  nutzer: z.string().min(1).max(256),
  von: z.string().min(1).max(100),
  methode: z.string().min(1).max(100),
});

/**
 * The agent asks for a new certificate before its own expires (BAULISTE.md Z-303), over the
 * connection its current one opened; as at the join, it sends only a request for a key it made
 */
export const ZertifikatAnfrage = z.object({
  typ: z.literal("zertifikat_anfrage"),
  protokoll,
  csr: pem("CERTIFICATE REQUEST"),
});

/** One part of a backup run (Z-601): its tag, and restic's snapshot ID when it made one */
const backupTeil = z.object({
  tag: z.string().min(1).max(300),
  ok: z.boolean(),
  snapshot: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  fehler: z.string().min(1).max(500).optional(),
});

/**
 * One run of an installation's backup on the server (Z-601; docs/plan.md, "Backup auf dem
 * Server"), as `sichern` wrote it: `lauf` is its own ID, so a run sent again after a reconnect is
 * one run; a reason names what failed, never the output of restic or of a command
 */
export const BackupLauf = z.object({
  lauf: id,
  beginn: zeitpunkt,
  ende: zeitpunkt,
  ok: z.boolean(),
  fehler: z.string().min(1).max(2000).optional(),
  teile: z.array(backupTeil).max(100),
});

export const BackupStand = BackupLauf.extend({
  typ: z.literal("backup_stand"),
  protokoll,
  installationId: id,
});

// Zentrale → Agent

/**
 * The answer to `hallo`; from now on the agent sends a heartbeat every 30 seconds. It names until
 * when the agent's certificate is valid, so the agent knows when to ask for a new one.
 */
export const Willkommen = z.object({
  typ: z.literal("willkommen"),
  protokoll,
  zeit: zeitpunkt,
  zertifikatGueltigBis: zeitpunkt.optional(),
});

/** The new certificate for a `zertifikat_anfrage`, with the CA of its operator */
export const Zertifikat = z.object({
  typ: z.literal("zertifikat"),
  protokoll,
  zertifikat: pem("CERTIFICATE"),
  ca: pem("CERTIFICATE"),
  gueltigBis: zeitpunkt,
});

const wert = z.union([z.string(), z.number(), z.boolean()]);

/**
 * What a setup job (`installation_einrichten`) tells the agent about the installation, besides its
 * name (`installationId`) and the signed manifest: the agent renders the units itself from both
 * (docs/plan.md, "Wer die Units einer Installation rendert"). The Zentrale stores it without the
 * `auto` values and adds them, decrypted, only when it sends the job
 */
export const Einrichtung = z.object({
  installation: z.object({
    kundeId: z.string().min(1).max(200),
    optionen: z.array(z.string().max(100)).max(50),
    httpPort: z.number().int().nullable(),
    ports: z.record(z.string().max(100), z.number().int()),
    host: z.string().min(1).max(253),
    ipv4: z.string().max(15).nullable(),
  }),
  einstellungen: z.object({
    betreiber: z.record(z.string(), wert),
    installation: z.record(z.string(), wert),
    auto: z.record(z.string(), wert),
  }),
});

/**
 * What `installation_backup_einrichten` tells the agent (Z-601): the installation's restic
 * repository on the operator's S3 target, the S3 access that reaches only its prefix, and its own
 * restic password. The Zentrale adds it, decrypted, only when it sends the job, like the `auto`
 * values of `einrichtung`; packages/manifest (backup/auftraege.ts) checks the form
 */
export const Backup = z.object({
  repository: z.string().min(1).max(1000),
  zugang: z.object({
    schluesselId: z.string().min(1).max(200),
    geheim: z.string().min(1).max(200),
  }),
  passwort: z.string().min(1).max(500),
});

export const Auftrag = z.object({
  typ: z.literal("auftrag"),
  protokoll,
  auftragId: id,
  installationId: id.nullable(),
  /** The name of an action the manifest describes (an action, a step or a named command) */
  aktion: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  argumente: z.record(z.string(), wert),
  manifest: z.string().min(1),
  signatur: z.string().min(1),
  zeitlimitS: z.number().int().positive(),
  /** Only with `installation_einrichten` (BAULISTE.md Z-402) */
  einrichtung: Einrichtung.optional(),
  /** Only with `installation_backup_einrichten` (BAULISTE.md Z-601) */
  backup: Backup.optional(),
});

export const VomAgenten = z.discriminatedUnion("typ", [
  Hallo,
  Heartbeat,
  Fakten,
  Zustand,
  Bestaetigt,
  Fortschritt,
  Ergebnis,
  LogAuszug,
  SshAnmeldung,
  ZertifikatAnfrage,
  BackupStand,
]);
export const VonDerZentrale = z.discriminatedUnion("typ", [Willkommen, Auftrag, Zertifikat]);

/**
 * Why the Zentrale closes an agent's connection, as WebSocket close codes (4000-4999 are the
 * application's, RFC 6455 7.4.2): the agent reconnects after each, after `gesperrt` only to be
 * refused again until the server is added anew
 */
export const TRENNUNG = {
  /** The certificate was revoked */
  gesperrt: 4403,
  /** A newer connection of the same server took over */
  ersetzt: 4409,
  /** A message the Zentrale could not read, or `hallo` missing */
  ungueltig: 4400,
  /** No message for too long: the connection is assumed dead */
  still: 4408,
} as const;

export type NachrichtVomAgenten = z.output<typeof VomAgenten>;
export type NachrichtVonDerZentrale = z.output<typeof VonDerZentrale>;

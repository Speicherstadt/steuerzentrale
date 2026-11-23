import { z } from "zod";

/*
 * The manifest of an app and version (docs/plan.md, "Manifest"; docs/manifest.md). Structure only;
 * the rules across fields (references, rootful only with a server of its own) are in pruefungen.ts.
 * Field names are German like the manifests themselves.
 */

const name = z.string().regex(/^[a-z][a-z0-9-]*$/, "lowercase letters, digits and dashes");
const envName = z.string().regex(/^[A-Z][A-Z0-9_]*$/, "uppercase letters, digits and underscores");
const port = z.number().int().min(1).max(65535);
const architektur = z.enum(["amd64", "arm64"]);

/**
 * An image only by digest: a tag can change under the same name (CLAUDE.md, "Never"). The first part
 * is a registry only with a dot, a port or as localhost (distribution/reference, normalize.go); else
 * Podman would resolve a short name through the search registries
 */
export const IMAGE =
  /^(?:[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?::[0-9]+)?|[a-z0-9][a-z0-9-]*:[0-9]+|localhost)(\/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$/;
const image = z.union([
  z
    .string()
    .regex(
      IMAGE,
      "an image needs registry, name and digest (…@sha256:<64 hex digits>), never a tag",
    ),
  z.strictObject({ noch_nicht_veroeffentlicht: z.string().min(1) }),
]);

const volume = z.strictObject({ name, pfad: z.string().startsWith("/", "an absolute path") });

/**
 * A configuration file with fixed content, mounted read-only into the container, e.g. the Caddyfile
 * of an app that brings its own proxy (Kontext, deploy/Caddyfile). Part of the signed manifest, so
 * it is no way around the signature; it is data for the container, never run by the agent.
 */
const datei = z.strictObject({
  pfad: z.string().startsWith("/", "an absolute path"),
  inhalt: z.string().min(1),
});

const container = z.strictObject({
  name,
  image,
  architektur: z.array(architektur).min(1).optional(),
  braucht: z.array(name).default([]),
  volumes: z.array(volume).default([]),
  dateien: z.array(datei).default([]),
  argv: z.array(z.string()).min(1).optional(),
  env: z.array(envName).default([]),
  feste_env: z.record(envName, z.string()).default({}),
  ram_mb: z.number().int().positive().optional(),
});

const http = z.strictObject({
  dienst: name,
  port,
  websocket: z.boolean().default(false),
  sse: z.boolean().default(false),
  max_body_mb: z.number().int().positive().default(10),
  timeout_s: z.number().int().positive().default(60),
});

const offenerPort = z.strictObject({
  dienst: name,
  port,
  bis: port.optional(),
  proto: z.enum(["tcp", "udp"]).default("tcp"),
  fest: z.boolean(),
});

const netz = z.strictObject({
  http: http.nullable().default(null),
  ports: z.array(offenerPort).default([]),
  oeffentliche_ipv4: z.boolean().default(false),
  mail: z.boolean().default(false),
  server_fuer_sich: z.boolean().default(false),
});

const option = z.strictObject({
  id: name,
  name: z.string().min(1),
  container: z.array(container).default([]),
  architektur: z.array(architektur).min(1).optional(),
  ram_mb: z.number().int().nonnegative().default(0),
  standard: z.boolean().default(false),
});

const health = z.discriminatedUnion("art", [
  z.strictObject({
    art: z.literal("http"),
    dienst: name,
    pfad: z.string().startsWith("/"),
    port: port.optional(),
  }),
  z.strictObject({ art: z.literal("tcp"), dienst: name, port }),
  z.strictObject({ art: z.literal("befehl"), befehl: name }),
  z.strictObject({ art: z.literal("keine"), hinweis: z.string().min(1) }),
]);

/**
 * An argument a job may give a named command (Z-305): every declared one is required, and its value
 * replaces the argv element `${arg:<name>}` as one whole word, never as text a shell would read.
 * A text needs a pattern it must match in full; a number is an integer.
 */
const argument = z.discriminatedUnion("typ", [
  z.strictObject({
    typ: z.literal("text"),
    muster: z.string().min(1),
    max_laenge: z.number().int().min(1).max(1000).default(200),
  }),
  z.strictObject({
    typ: z.literal("zahl"),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.strictObject({ typ: z.literal("ja_nein") }),
  z.strictObject({ typ: z.literal("auswahl"), werte: z.array(z.string().min(1)).min(1) }),
]);

/** The longest time limit of a command: a day */
export const MAX_ZEITLIMIT_S = 86_400;

/**
 * A named command: a container and an argv, never a string a shell would parse. A job runs it with
 * its arguments and within `zeitlimit_s` (else STANDARD_ZEITLIMIT_S); `idempotent: true` lets the
 * agent run it again after a restart instead of reporting it failed (docs/plan.md, "Aufträge")
 */
const befehl = z.strictObject({
  container: name,
  argv: z.array(z.string()).min(1),
  argumente: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), argument).default({}),
  zeitlimit_s: z.number().int().min(1).max(MAX_ZEITLIMIT_S).optional(),
  idempotent: z.boolean().default(false),
});

const backupTeil = z.discriminatedUnion("art", [
  z.strictObject({
    art: z.literal("pg_dump"),
    container: name,
    datenbank: z.string().min(1),
    nutzer: z.string().min(1),
  }),
  z.strictObject({ art: z.literal("volume"), volume: name }),
  z.strictObject({ art: z.literal("befehl"), befehl: name }),
]);

const NICHT = "nicht_unterstuetzt";
const aktion = z.union([
  z.literal(NICHT),
  z.strictObject({ nicht_unterstuetzt: z.string().min(1) }),
  z.strictObject({ befehl: name }),
]);
const grundaktion = z.union([
  z.literal("angeboten"),
  z.literal(NICHT),
  z.strictObject({ nicht_unterstuetzt: z.string().min(1) }),
]);

const sperrzeit = z.strictObject({
  monatlich: z
    .string()
    .regex(/^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|[12][0-9]|3[01])$/, "days as DD-DD"),
  grund: z.string().min(1),
});

const dnsEintrag = z.strictObject({
  typ: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV"]),
  name: z.string().min(1),
  wert: z.string().min(1),
  prioritaet: z.number().int().nonnegative().optional(),
});

const env = z.strictObject({
  name: envName,
  ebene: z.enum(["betreiber", "installation", "auto"]),
  typ: z.enum(["text", "zahl", "ja_nein", "geheim"]).default("text"),
  pflicht: z.boolean().default(false),
  vorgabe: z.union([z.string(), z.number(), z.boolean()]).optional(),
  beschreibung: z.string().optional(),
  // zufall_32/_64: random bytes in standard base64; zufall_hex_32: 32 random bytes as 64 hex digits,
  // for values that end up inside a URL such as a database password in DATABASE_URL
  erzeugen: z.enum(["zufall_32", "zufall_64", "zufall_hex_32"]).optional(),
  aus: z.enum(["oidc-anbieter", "adresse"]).optional(),
  // A text with placeholders ${adresse}, ${host}, ${port:<dienst>:<port>}, ${env:<NAME>}
  vorlage: z.string().optional(),
  // Set only while this option is on (e.g. Kontext's SCHREIBZEUG_URL with "documents")
  option: name.optional(),
});

// SemVer 2.0.0: no leading zero in a number of the core, so one version has one spelling and an
// imported version cannot come again as another (Z-501; packages/planung, versionen.ts)
const semver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/,
    "a version as major.minor.patch",
  );

export const ManifestStruktur = z.strictObject({
  schema: z.literal(1),
  id: name,
  version: semver,
  lizenz: z.string().min(1),
  quelle: z.url(),
  container: z.array(container).min(1),
  architektur: z.array(architektur).min(1),
  ressourcen: z.strictObject({
    ram_mb: z.number().int().positive(),
    platte_gb: z.number().int().positive(),
  }),
  netz,
  proxy: z.enum(["geteilt", "eigen"]).default("geteilt"),
  rootful: z.boolean().default(false),
  optionen: z.array(option).default([]),
  braucht: z.array(name).default([]),
  bietet: z.array(name).default([]),
  anmeldung: z.enum(["oidc", "eigen", "anbieter"]),
  health,
  befehle: z.record(name, befehl).default({}),
  schritte: z
    // Any string here, so a shell line fails with "not the name of a command" (pruefungen.ts)
    .strictObject({
      einrichten: z.array(z.string()).default([]),
      nach_update: z.array(z.string()).default([]),
    })
    .default({ einrichten: [], nach_update: [] }),
  backup: z.array(backupTeil).default([]),
  aktionen: z.strictObject({
    nur_lesen: aktion,
    export: aktion,
    neustart: grundaktion.default("angeboten"),
    log_auszug: grundaktion.default("angeboten"),
  }),
  sperrzeiten: z.array(sperrzeit).default([]),
  dns: z.array(dnsEintrag).default([]),
  env: z.array(env).default([]),
  dringend: z.boolean().default(false),
  hinweis: z.string().optional(),
});

export type Manifest = z.output<typeof ManifestStruktur>;
export type Container = z.output<typeof container>;
export type Befehl = z.output<typeof befehl>;
export type Argument = z.output<typeof argument>;

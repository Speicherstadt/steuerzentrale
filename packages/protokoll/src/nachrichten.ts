import { z } from "zod";

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

/** What the agent reads from its server (Z-304); a fact it cannot read is null, not invented */
export const Fakten = z.object({
  typ: z.literal("fakten"),
  protokoll,
  zeit: zeitpunkt,
  cpuKerne: z.number().int().positive(),
  ramMb: z.number().int().positive(),
  platten: z.array(platte),
  architektur,
  os: z.object({ name: z.string(), version: z.string() }),
  kernel: z.object({ laeuft: z.string(), installiert: z.string().nullable() }),
  neustartNoetig: z.boolean(),
  updatesAusstehend: z.number().int().nonnegative().nullable(),
  podman: z.string().nullable(),
  ipv4: z.array(z.string()),
  ipv6: z.array(z.string()),
  ptr: z.record(z.string(), z.string()),
  portsBelegt: z.array(
    z.object({ port: z.number().int().min(1).max(65535), proto: z.enum(["tcp", "udp"]) }),
  ),
  port25Ausgehend: z.boolean().nullable(),
  uhrzeitAbweichungMs: z.number().int().nullable(),
});

const unit = z.object({
  name: z.string().min(1),
  aktiv: z.enum(["active", "inactive", "failed", "activating", "deactivating", "unknown"]),
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
  schritt: z.string().min(1),
  zeit: zeitpunkt,
});

export const Ergebnis = z.object({
  typ: z.literal("ergebnis"),
  protokoll,
  auftragId: id,
  zeit: zeitpunkt,
  ergebnis: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), daten: z.record(z.string(), z.unknown()).default({}) }),
    z.object({ ok: z.literal(false), fehler: z.string().min(1) }),
  ]),
});

/** At most 500 lines (Z-405), values of the installation's secrets already replaced by the agent */
export const LogAuszug = z.object({
  typ: z.literal("log_auszug"),
  protokoll,
  auftragId: id,
  zeilen: z.array(z.string()).max(500),
});

export const SshAnmeldung = z.object({
  typ: z.literal("ssh_anmeldung"),
  protokoll,
  zeit: zeitpunkt,
  nutzer: z.string().min(1),
  von: z.string().min(1),
  methode: z.string().min(1),
});

// Zentrale → Agent

export const Willkommen = z.object({ typ: z.literal("willkommen"), protokoll, zeit: zeitpunkt });

export const Auftrag = z.object({
  typ: z.literal("auftrag"),
  protokoll,
  auftragId: id,
  installationId: id.nullable(),
  /** The name of an action the manifest describes (an action, a step or a named command) */
  aktion: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  argumente: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  manifest: z.string().min(1),
  signatur: z.string().min(1),
  zeitlimitS: z.number().int().positive(),
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
]);
export const VonDerZentrale = z.discriminatedUnion("typ", [Willkommen, Auftrag]);

export type NachrichtVomAgenten = z.output<typeof VomAgenten>;
export type NachrichtVonDerZentrale = z.output<typeof VonDerZentrale>;

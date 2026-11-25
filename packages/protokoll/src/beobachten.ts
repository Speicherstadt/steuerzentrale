import { z } from "zod";

/*
 * Units the agent reads but no manifest describes (BAULISTE.md Z-1103; docs/plan.md, "Vorhandene
 * Units lesen"): of an observed service on an observed server, the Linux user (or the system), its
 * systemd units and, if the operator wants, a check on 127.0.0.1. The agent reads them only with
 * `systemctl show` and the HTTP or TCP check; it starts and stops nothing. The Zentrale and the
 * agent check the names with the same functions here: no whitespace, `;`, `/` or `\`, never a
 * leading `-` (an option of runuser or systemctl), and the unit with its type.
 */

/** The most units of one service, and services on one server */
export const UNITS_MAX = 20;
export const BEOBACHTET_MAX = 100;

/** A user name as useradd takes it on Debian and Ubuntu (NAME_REGEX), lowercase, at most 32 */
const LINUX_NUTZER = /^[a-z_][a-z0-9_-]{0,31}$/;

/**
 * A unit name of systemd (systemd.unit(5)): letters, digits, `:`, `_`, `.`, `@` and `-`, not first
 * `-`, with the type of unit; escapes (`\x2d`) are not taken
 */
const UNIT =
  /^[A-Za-z0-9_:.@][A-Za-z0-9_:.@-]{0,200}\.(service|socket|timer|target|mount|automount|path|swap|slice|scope)$/;

/** The longest health path taken */
export const PFAD_MAX = 200;

export const linuxNutzerGueltig = (name: string): boolean => LINUX_NUTZER.test(name);

export const unitGueltig = (name: string): boolean => UNIT.test(name);

/** A path the check asks for: starts with one `/`, no query, fragment or whitespace */
export const healthPfadGueltig = (pfad: string): boolean =>
  pfad.length <= PFAD_MAX && /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(pfad);

const port = z.number().int().min(1).max(65535);

/** The check on 127.0.0.1, as an installation's (Z-403): `http` 200–399 green, `tcp` a connection */
export const BeobachtetHealth = z.discriminatedUnion("art", [
  z.object({ art: z.literal("http"), port, pfad: z.string().refine(healthPfadGueltig) }).strict(),
  z.object({ art: z.literal("tcp"), port }).strict(),
  z.object({ art: z.literal("keine") }).strict(),
]);

export const BeobachteterDienst = z
  .object({
    dienstId: z.string().min(1).max(200),
    /** The user whose units these are; null for units of the system */
    nutzer: z.string().refine(linuxNutzerGueltig).nullable(),
    units: z.array(z.string().refine(unitGueltig)).min(1).max(UNITS_MAX),
    health: BeobachtetHealth,
  })
  .strict();

export type BeobachteterDienst = z.output<typeof BeobachteterDienst>;

/**
 * Zentrale → agent: every observed service on this server, after `willkommen` and whenever one
 * changes; the newest list replaces the one before
 */
export const Beobachten = z.object({
  typ: z.literal("beobachten"),
  protokoll: z.number().int().positive(),
  dienste: z.array(BeobachteterDienst).max(BEOBACHTET_MAX),
});

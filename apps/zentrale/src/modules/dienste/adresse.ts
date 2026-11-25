import { isIP } from "node:net";

/*
 * The address of an observed service (BAULISTE.md Z-1101): `https://<host>` and nothing else. The
 * check from outside resolves the host and connects to its public addresses on port 443
 * (modules/aussen/sonde.ts), so a port, a path (that is the health path's field), a user or an IP
 * address would promise something the check does not do. The host needs a dot: a name without one
 * (`localhost`) never is a public service.
 */

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

const istHost = (host: string): boolean =>
  host.length <= 253 &&
  host.includes(".") &&
  isIP(host) === 0 &&
  host.split(".").every((teil) => LABEL.test(teil));

/** The host of `https://<host>` (a trailing `/` allowed), lowercase, or undefined */
export const hostAusAdresse = (adresse: string): string | undefined => {
  const treffer = /^https:\/\/([^/?#@:[\]\s]+)\/?$/i.exec(adresse.trim());
  const host = treffer?.[1]?.toLowerCase();
  return host !== undefined && istHost(host) ? host : undefined;
};

/** The longest health path taken */
export const PFAD_MAX = 200;

/** A path the check asks for: starts with one `/`, no query, fragment or whitespace */
export const pfadGueltig = (pfad: string): boolean =>
  pfad.length <= PFAD_MAX && /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(pfad);

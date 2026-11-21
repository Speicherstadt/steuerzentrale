import { HOST, INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import { type PforteRoute, pforteRoute } from "../quadlet/pforte.ts";
import type { Manifest } from "../schema.ts";

/*
 * The Pforte's jobs (BAULISTE.md Z-401; docs/plan.md, "Pforte-Aufträge"): built into the
 * Steuerzentrale, not described by an app's manifest, with a fixed shape. A job carries the signed
 * manifest of the installation's app like every job (the agent checks the signature first), the
 * installation's name, and for a route its host and the port on 127.0.0.1; the route itself is
 * rendered from the manifest (quadlet/pforte.ts), never taken from the job. Pure: the Zentrale checks
 * a job with it when it makes one, the agent again before it calls Caddy's admin API.
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name these */
export const PFORTE_AKTIONEN = {
  setzen: "pforte_route_setzen",
  entfernen: "pforte_route_entfernen",
} as const;

/** The admin API answers in milliseconds; the Zentrale may shorten this, never lengthen it */
export const PFORTE_ZEITLIMIT_S = 60;

/** The port of an installation's HTTP service on 127.0.0.1: never a privileged one */
export const PFORTE_PORT = { min: 1024, max: 65535 } as const;

export type PforteAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, string | number | boolean>>;
};

export type PforteAuftrag =
  | { art: "setzen"; route: PforteRoute }
  | { art: "entfernen"; id: string };
export type PforteGeprueft = { ok: true; auftrag: PforteAuftrag } | { ok: false; grund: string };

export const istPforteAktion = (aktion: string): boolean =>
  Object.values<string>(PFORTE_AKTIONEN).includes(aktion);

const nein = (grund: string): PforteGeprueft => ({ ok: false, grund });

const nurArgumente = (a: PforteAnfrage, erlaubt: readonly string[]): string | null => {
  const fremd = Object.keys(a.argumente).filter((n) => !erlaubt.includes(n));
  return fremd.length > 0 ? `unknown argument ${fremd.join(", ")}` : null;
};

const routePruefen = (m: Manifest, name: string, a: PforteAnfrage): PforteGeprueft => {
  const fremd = nurArgumente(a, ["host", "port"]);
  if (fremd) return nein(fremd);
  const { host, port } = a.argumente;
  if (typeof host !== "string" || !HOST.test(host))
    return nein("argument host: a lowercase host name with a dot");
  if (
    typeof port !== "number" ||
    !Number.isSafeInteger(port) ||
    port < PFORTE_PORT.min ||
    port > PFORTE_PORT.max
  )
    return nein(`argument port: an integer from ${PFORTE_PORT.min} to ${PFORTE_PORT.max}`);
  if (m.proxy !== "geteilt") return nein("the app brings a proxy of its own: no route");
  if (!m.netz.http) return nein("the app has no HTTP service (netz.http): no route");
  return {
    ok: true,
    auftrag: { art: "setzen", route: pforteRoute(m.netz.http, { name, host, httpPort: port }) },
  };
};

export const pforteAuftragPruefen = (m: Manifest, a: PforteAnfrage): PforteGeprueft => {
  if (!istPforteAktion(a.aktion)) return nein(`${a.aktion} is not a job of the Pforte`);
  const name = a.installationId;
  if (name === null || !INSTALLATIONS_NAME.test(name))
    return nein("a route belongs to a named installation");
  if (a.aktion === PFORTE_AKTIONEN.setzen) return routePruefen(m, name, a);
  const fremd = nurArgumente(a, []);
  return fremd ? nein(fremd) : { ok: true, auftrag: { art: "entfernen", id: name } };
};

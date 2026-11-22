import { GRUND_ID, type PforteGrund, type PforteRoute } from "@steuerzentrale/manifest";
import type { Ergebnis } from "../auftraege/ausfuehren.ts";

/*
 * The Pforte's routes through Caddy's admin API (BAULISTE.md Z-401; https://caddyserver.com/docs/api,
 * caddyserver/caddy v2.11.9 admin.go): every change is a graceful reload of the running Caddy, never
 * a restart, and Caddy rolls back a change it cannot load. The API listens on a Unix socket in the
 * home of sz-pforte (packages/manifest, pforte/unit.ts), which the agent reaches as root; the request
 * goes through a fetch passed in, so the logic is tested without a Caddy.
 */

/** Where the agent finds the admin socket: `%h/pforte` of sz-pforte (install.sh makes the user) */
export const PFORTE_ADMIN_SOCKET = "/home/sz-pforte/pforte/admin.sock";

export type Methode = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AdminAntwort = { status: number; text: string };
/** One request to the admin API; throws when the Pforte does not answer */
export type Admin = (
  methode: Methode,
  pfad: string,
  body: unknown,
  signal: AbortSignal,
) => Promise<AdminAntwort>;

/** Bun's fetch speaks HTTP over a Unix socket with the `unix` option */
export type SocketFetch = (url: string, init: RequestInit & { unix: string }) => Promise<Response>;

export const adminUeberSocket =
  (f: SocketFetch, socket: string): Admin =>
  async (methode, pfad, body, signal) => {
    const antwort = await f(`http://localhost${pfad}`, {
      method: methode,
      // Caddy takes a config only as JSON (admin.go, handleConfig)
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      // Caddy replaces its admin server with every change (admin.go, replaceLocalAdminServer): a
      // kept-alive connection would end with it
      keepalive: false,
      unix: socket,
    });
    return { status: antwort.status, text: await antwort.text() };
  };

type Schritt = { ok: true; antwort: AdminAntwort } | { ok: false; fehler: string };

const anfragen = async (
  admin: Admin,
  methode: Methode,
  pfad: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Schritt> => {
  try {
    return { ok: true, antwort: await admin(methode, pfad, body, signal) };
  } catch (fehler) {
    return { ok: false, fehler: `Pforte nicht erreichbar: ${String(fehler)}`.slice(0, 500) };
  }
};

const abgelehnt = (methode: Methode, pfad: string, a: AdminAntwort): Ergebnis => ({
  ok: false,
  fehler: `Pforte lehnte ab: ${methode} ${pfad}: HTTP ${a.status} ${a.text.trim()}`.slice(0, 500),
});

/** Runs the requests in order; each may answer with one of its expected statuses, else it stops */
const folge = async (
  admin: Admin,
  signal: AbortSignal,
  schritte: readonly { methode: Methode; pfad: string; body?: unknown; erwartet: number[] }[],
): Promise<{ ok: true; status: number[] } | { ok: false; ergebnis: Ergebnis }> => {
  const status: number[] = [];
  for (const s of schritte) {
    const r = await anfragen(admin, s.methode, s.pfad, s.body, signal);
    if (!r.ok) return { ok: false, ergebnis: r };
    if (!s.erwartet.includes(r.antwort.status))
      return { ok: false, ergebnis: abgelehnt(s.methode, s.pfad, r.antwort) };
    status.push(r.antwort.status);
  }
  return { ok: true, status };
};

type Gesetzt = { "@id"?: unknown; match?: unknown; handle?: unknown };

/**
 * The routes of the Pforte's HTTPS server. A fresh Pforte has no configuration yet: the base
 * configuration is loaded once, and its routes are the ones there are
 */
const routenLesen = async (
  admin: Admin,
  grund: PforteGrund,
  signal: AbortSignal,
): Promise<{ ok: true; routen: Gesetzt[] } | { ok: false; ergebnis: Ergebnis }> => {
  const r = await anfragen(admin, "GET", `/id/${GRUND_ID}`, undefined, signal);
  if (!r.ok) return { ok: false, ergebnis: r };
  if (r.antwort.status === 404) {
    const geladen = await folge(admin, signal, [
      { methode: "POST", pfad: "/load", body: grund, erwartet: [200] },
    ]);
    if (!geladen.ok) return geladen;
    return { ok: true, routen: Object.values(grund.apps.http.servers).flatMap((s) => s.routes) };
  }
  if (r.antwort.status !== 200)
    return { ok: false, ergebnis: abgelehnt("GET", `/id/${GRUND_ID}`, r.antwort) };
  try {
    const server = JSON.parse(r.antwort.text) as { routes?: unknown };
    if (Array.isArray(server.routes)) return { ok: true, routen: server.routes as Gesetzt[] };
  } catch {}
  return { ok: false, ergebnis: { ok: false, fehler: "Pforte: Routen nicht lesbar" } };
};

/** Host names a route matches, lower case as Caddy compares them (caddyhttp/matchers.go, MatchHost) */
const hostsVon = (r: Gesetzt): string[] =>
  Array.isArray(r.match)
    ? r.match.flatMap((m: { host?: unknown }) =>
        Array.isArray(m?.host) ? m.host.map((h) => String(h).toLowerCase()) : [],
      )
    : [];

/** The upstreams a route proxies to */
const upstreamsVon = (r: Gesetzt): string[] =>
  Array.isArray(r.handle)
    ? r.handle.flatMap((h: { upstreams?: unknown }) =>
        Array.isArray(h?.upstreams)
          ? h.upstreams.map((u: { dial?: unknown }) => String(u?.dial))
          : [],
      )
    : [];

/**
 * A host or upstream of the new route that another installation's route has already: setting it
 * would take that installation's requests away, or serve them under a foreign address
 */
const fremdBelegt = (routen: Gesetzt[], route: PforteRoute): string | null => {
  const hosts = new Set(hostsVon(route));
  const upstreams = new Set(upstreamsVon(route));
  for (const r of routen) {
    if (r["@id"] === route["@id"]) continue;
    const host = hostsVon(r).find((h) => hosts.has(h));
    if (host) return `Host ${host} gehört schon zur Route ${String(r["@id"])}`;
    const upstream = upstreamsVon(r).find((u) => upstreams.has(u));
    if (upstream) return `${upstream} gehört schon zur Route ${String(r["@id"])}`;
  }
  return null;
};

/**
 * Sets the route of an installation: replaces it when its `@id` is there (PATCH), else puts it in
 * front of the base configuration's 404 route (PUT …/routes/0), so the same job twice is one route.
 * A host or upstream port of another installation's route is refused before anything changes; the
 * agent runs the Pforte's jobs one after another (auftraege.ts), so no other job changes the routes
 * between reading and writing
 */
export const routeSetzen = async (
  admin: Admin,
  grund: PforteGrund,
  route: PforteRoute,
  signal: AbortSignal,
): Promise<Ergebnis> => {
  const id = route["@id"];
  const gelesen = await routenLesen(admin, grund, signal);
  if (!gelesen.ok) return gelesen.ergebnis;
  const belegt = fremdBelegt(gelesen.routen, route);
  if (belegt) return { ok: false, fehler: `abgelehnt: ${belegt}` };
  const ersetzt = await folge(admin, signal, [
    { methode: "PATCH", pfad: `/id/${id}`, body: route, erwartet: [200, 404] },
  ]);
  if (!ersetzt.ok) return ersetzt.ergebnis;
  if (ersetzt.status[0] === 200) return { ok: true, daten: { route: id, geaendert: "ersetzt" } };
  const neu = await folge(admin, signal, [
    { methode: "PUT", pfad: `/id/${GRUND_ID}/routes/0`, body: route, erwartet: [200] },
  ]);
  return neu.ok ? { ok: true, daten: { route: id, geaendert: "neu" } } : neu.ergebnis;
};

/** Removes the route of an installation; one that is not there is removed already */
export const routeEntfernen = async (
  admin: Admin,
  id: string,
  signal: AbortSignal,
): Promise<Ergebnis> => {
  const r = await folge(admin, signal, [
    { methode: "DELETE", pfad: `/id/${id}`, erwartet: [200, 404] },
  ]);
  if (!r.ok) return r.ergebnis;
  return { ok: true, daten: { route: id, geaendert: r.status[0] === 200 ? "entfernt" : "nichts" } };
};

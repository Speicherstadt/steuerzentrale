import { PFORTE_SERVER, type PforteOptionen, pforteGrundkonfiguration } from "./grund.ts";

/*
 * The Zentrale behind the Pforte of its own server (docs/plan.md, "TLS und Zertifikate" and
 * "Vorderseite der Zentrale (Z-1004)"): Caddy ends TLS for the interface and for agent.<domain>,
 * lets the interface in only from the given networks (WireGuard), opens on agent.<domain> only
 * what agents call, asks there for a client certificate (`verify_if_given`: install.sh and the
 * token's exchange come without one) checked against the operators' CAs, and passes its SHA-256 on
 * to the Zentrale on 127.0.0.1, which believes the header from loopback only (herkunft.ts).
 * The result is a whole configuration for `POST /load`, made from the one the Pforte has (or the base
 * configuration): the installations' routes stay, the Zentrale's own are replaced.
 * Field names from caddyserver/caddy v2.11.9: modules/caddytls (connpolicy.go: match,
 * client_authentication, ca, mode; capools.go: provider "inline", trusted_ca_certs as base64 DER;
 * matchers.go: sni), modules/caddyhttp (ip_matchers.go: remote_ip ranges; app.go: the placeholder
 * {http.request.tls.client.fingerprint}; server.go: tls_connection_policies).
 */

export const ZENTRALE_UI_ID = "sz_zentrale_ui";
export const ZENTRALE_AGENT_ID = "sz_zentrale_agent";
/** The header the Zentrale reads the fingerprint from (apps/zentrale, herkunft.ts) */
export const FINGERABDRUCK_KOPF = "X-SZ-Client-Fingerabdruck";
/** What agents and install.sh call on agent.<domain> (apps/zentrale, routes/zugang.ts) and /health */
export const AGENT_PFADE = ["/install.sh", "/agent/*", "/api/v1/agent/*", "/health"];

export type ZentraleVorne = {
  /** The interface's host (STEUERZENTRALE_URL) */
  uiHost: string;
  /** agent.<domain> (STEUERZENTRALE_AGENT_URL) */
  agentHost: string;
  /** The Zentrale's port on 127.0.0.1 */
  port: number;
  /** The networks the interface is reached from, as CIDR (the WireGuard network) */
  uiNetze: string[];
  /** The operators' agent CAs, base64 DER */
  clientCas: string[];
  zertifikate?: PforteOptionen["zertifikate"];
};

type Route = { "@id": string; [feld: string]: unknown };
type Konfiguration = {
  apps: { http: { servers: Record<string, { routes: Route[]; [feld: string]: unknown }> } };
};

const HOST =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_NETZ = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV6_NETZ = /^[0-9a-f:]+\/\d{1,3}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const fehler = (vorne: ZentraleVorne): string | undefined => {
  if (!HOST.test(vorne.uiHost) || !HOST.test(vorne.agentHost))
    return "the hosts must be lower-case host names";
  if (vorne.uiHost === vorne.agentHost) return "the interface and agent.<domain> need two hosts";
  if (!Number.isInteger(vorne.port) || vorne.port < 1 || vorne.port > 65535)
    return "the port must be 1-65535";
  if (vorne.uiNetze.length === 0) return "at least one network for the interface";
  if (!vorne.uiNetze.every((n) => IPV4_NETZ.test(n) || IPV6_NETZ.test(n)))
    return "networks as CIDR, e.g. 10.8.0.0/24";
  if (!vorne.clientCas.every((ca) => BASE64.test(ca))) return "CAs as base64 DER";
  return undefined;
};

const proxy = (port: number, setzen: Record<string, string[]>, loeschen: string[]) => ({
  handler: "reverse_proxy",
  upstreams: [{ dial: `127.0.0.1:${port}` }],
  // Only the address the Pforte saw counts (as quadlet/pforte.ts)
  headers: {
    request: {
      set: { "X-Forwarded-For": ["{http.request.remote.host}"], ...setzen },
      delete: ["Forwarded", "X-Real-IP", ...loeschen],
    },
  },
});

const routen = (v: ZentraleVorne): Route[] => [
  {
    "@id": ZENTRALE_UI_ID,
    match: [{ host: [v.uiHost], remote_ip: { ranges: v.uiNetze } }],
    handle: [proxy(v.port, {}, [FINGERABDRUCK_KOPF])],
    terminal: true,
  },
  ...(v.clientCas.length === 0
    ? []
    : [
        {
          "@id": ZENTRALE_AGENT_ID,
          match: [{ host: [v.agentHost], path: AGENT_PFADE }],
          handle: [
            {
              ...proxy(
                v.port,
                { [FINGERABDRUCK_KOPF]: ["{http.request.tls.client.fingerprint}"] },
                [],
              ),
              // the agent's WebSocket outlives a change of the Pforte's configuration
              stream_close_delay: "5m",
            },
          ],
          terminal: true,
        },
      ]),
];

const richtlinien = (v: ZentraleVorne) => [
  ...(v.clientCas.length === 0
    ? []
    : [
        {
          match: { sni: [v.agentHost] },
          client_authentication: {
            ca: { provider: "inline", trusted_ca_certs: v.clientCas },
            mode: "verify_if_given",
          },
        },
      ]),
  {},
];

/**
 * A route of an installation that has a host or the upstream of the Zentrale (docs/pforte.md: no
 * installation takes a name of the Zentrale). Behind the Zentrale's routes it would still get the
 * interface's host from every other address and agent.<domain> for every other path. Hosts lower
 * case as Caddy compares them (caddyhttp/matchers.go, MatchHost), as the agent checks (fremdBelegt)
 */
const belegtDurch = (routen: Route[], v: ZentraleVorne): string | undefined => {
  const hosts = new Set([v.uiHost, v.agentHost]);
  const upstream = `127.0.0.1:${v.port}`;
  const liste = (wert: unknown): Record<string, unknown>[] =>
    Array.isArray(wert) ? (wert as Record<string, unknown>[]) : [];
  return routen
    .filter((r) => r["@id"] !== ZENTRALE_UI_ID && r["@id"] !== ZENTRALE_AGENT_ID)
    .find(
      (r) =>
        liste(r.match).some((m) =>
          liste(m?.host).some((h) => hosts.has(String(h).toLowerCase())),
        ) || liste(r.handle).some((h) => liste(h?.upstreams).some((u) => u?.dial === upstream)),
    )?.["@id"];
};

const istKonfiguration = (wert: unknown): wert is Konfiguration => {
  const server = (wert as Konfiguration | null)?.apps?.http?.servers?.[PFORTE_SERVER];
  return typeof server === "object" && server !== null && Array.isArray(server.routes);
};

export const zentraleInPforte = (
  aktuell: unknown,
  vorne: ZentraleVorne,
): { ok: true; konfiguration: unknown } | { ok: false; grund: string } => {
  const falsch = fehler(vorne);
  if (falsch) return { ok: false, grund: falsch };
  const basis: unknown =
    aktuell === null || aktuell === undefined
      ? pforteGrundkonfiguration(vorne.zertifikate ? { zertifikate: vorne.zertifikate } : {})
      : structuredClone(aktuell);
  if (!istKonfiguration(basis)) return { ok: false, grund: "not the Pforte's configuration" };
  const server = basis.apps.http.servers[
    PFORTE_SERVER
  ] as Konfiguration["apps"]["http"]["servers"][string];
  const fremd = belegtDurch(server.routes, vorne);
  if (fremd !== undefined)
    return { ok: false, grund: `route ${fremd} has a host or the port of the Zentrale` };
  const eigene = new Set([ZENTRALE_UI_ID, ZENTRALE_AGENT_ID]);
  server.routes = [...routen(vorne), ...server.routes.filter((r) => !eigene.has(r["@id"]))];
  server.tls_connection_policies = richtlinien(vorne);
  return { ok: true, konfiguration: basis };
};

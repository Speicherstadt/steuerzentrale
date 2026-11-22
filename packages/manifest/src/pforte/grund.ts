/*
 * The base configuration of the Pforte, the server's Caddy (docs/plan.md, "Pforte"), as JSON for
 * `POST /load` of its admin API. The routes of the installations are added and removed one by one
 * (quadlet/pforte.ts, auftraege.ts); every change is a graceful reload of Caddy, never a restart.
 * Field names from caddyserver/caddy v2.11.9 (commit 0d98caea): admin.go (admin.listen,
 * admin.config.persist; a Unix socket skips the Host check, newAdminHandler), modules/caddyhttp
 * (app.go: http_port, https_port; server.go: listen, routes; staticresp.go: status_code),
 * modules/caddytls (automation.policies, issuer module "internal" = `tls internal`), modules/caddypki
 * (ca.go: install_trust).
 */

/** The name of the Pforte's HTTPS server under apps.http.servers */
export const PFORTE_SERVER = "pforte";
/**
 * `@id`s of the base configuration's own objects. An installation's route has its name as `@id`
 * (INSTALLATIONS_NAME: letters, digits, dashes), so an underscore keeps these apart for good
 */
export const GRUND_ID = "sz_grund";
export const UNBEKANNT_ID = "sz_unbekannt";

/** The admin API's socket inside the container; the unit mounts its folder from the user's home */
export const PFORTE_ADMIN_IM_CONTAINER = "/run/pforte/admin.sock";

export type PforteOptionen = {
  /** 80 on a server; HTTP-01 and the redirect to HTTPS */
  httpPort?: number;
  /** 443 on a server */
  httpsPort?: number;
  /** `acme`: Caddy's default issuers (Let's Encrypt, HTTP-01); `intern`: its local CA, for tests */
  zertifikate?: "acme" | "intern";
};

type Route = {
  "@id": string;
  match?: { host: string[] }[];
  handle: Record<string, unknown>[];
  terminal: true;
};

export type PforteGrund = {
  admin: { listen: string; config: { persist: true } };
  apps: {
    http: {
      http_port: number;
      https_port: number;
      servers: Record<string, { "@id": string; listen: string[]; routes: Route[] }>;
    };
    tls?: { automation: { policies: { issuers: { module: string }[] }[] } };
    pki?: { certificate_authorities: { local: { install_trust: false } } };
  };
};

/**
 * The last route: a host without a route of its own gets 404 instead of Caddy's empty 200. A new
 * installation's route goes in front of it (PUT …/routes/0)
 */
const unbekannt: Route = {
  "@id": UNBEKANNT_ID,
  handle: [{ handler: "static_response", status_code: 404 }],
  terminal: true,
};

/** Only a test trusts the local CA; it is never put into the system's trust store */
const lokaleCa = {
  tls: { automation: { policies: [{ issuers: [{ module: "internal" }] }] } },
  pki: { certificate_authorities: { local: { install_trust: false as const } } },
};

export const pforteGrundkonfiguration = (o: PforteOptionen = {}): PforteGrund => {
  const httpsPort = o.httpsPort ?? 443;
  return {
    // persist: Caddy autosaves every change, and `caddy run --resume` starts from it again
    admin: { listen: `unix/${PFORTE_ADMIN_IM_CONTAINER}`, config: { persist: true } },
    apps: {
      http: {
        http_port: o.httpPort ?? 80,
        https_port: httpsPort,
        servers: {
          [PFORTE_SERVER]: { "@id": GRUND_ID, listen: [`:${httpsPort}`], routes: [unbekannt] },
        },
      },
      ...(o.zertifikate === "intern" ? lokaleCa : {}),
    },
  };
};

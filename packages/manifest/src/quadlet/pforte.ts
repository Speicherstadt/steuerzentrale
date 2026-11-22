import type { Manifest } from "../schema.ts";

/*
 * The route of an installation in the Pforte, the server's Caddy (docs/plan.md, "Pforte"), as JSON
 * for its admin API: set in front of the routes of the HTTP server (PUT …/routes/0, or PATCH /id/<@id>
 * when it is there), removed with DELETE /id/<@id> (apps/agent/src/pforte/admin.ts).
 * Field names from caddyserver/caddy v2.11.9 (commit 0d98caea), the Pforte's version (system.ts),
 * as in v2.10.2 (commit 551f7937): modules/caddyhttp/reverseproxy
 * (reverseproxy.go: upstreams, headers, flush_interval, stream_close_delay; httptransport.go:
 * response_header_timeout), modules/caddyhttp/requestbody (request_body, max_size in bytes),
 * modules/caddyhttp/headers (request set/delete); durations as strings (caddy.go, Duration).
 */

type Handler =
  | { handler: "request_body"; max_size: number }
  | {
      handler: "reverse_proxy";
      upstreams: { dial: string }[];
      transport: { protocol: "http"; response_header_timeout: string };
      headers: { request: { set: Record<string, string[]>; delete: string[] } };
      /** -1: every write goes to the client at once, for server-sent events */
      flush_interval?: number;
      /** WebSockets stay open this long when the Pforte's config changes (an address added or removed) */
      stream_close_delay?: string;
    };

export type PforteRoute = {
  "@id": string;
  match: { host: string[] }[];
  handle: Handler[];
  terminal: true;
};

/** How long a WebSocket outlives a config change of the Pforte */
export const STREAM_SCHLIESSEN_NACH = "5m";

export const pforteRoute = (
  http: NonNullable<Manifest["netz"]["http"]>,
  installation: { name: string; host: string; httpPort: number },
): PforteRoute => ({
  "@id": installation.name,
  match: [{ host: [installation.host] }],
  handle: [
    { handler: "request_body", max_size: http.max_body_mb * 1024 * 1024 },
    {
      handler: "reverse_proxy",
      upstreams: [{ dial: `127.0.0.1:${installation.httpPort}` }],
      transport: { protocol: "http", response_header_timeout: `${http.timeout_s}s` },
      // Only the address the Pforte saw counts; no client names another one (as Kontext's Caddyfile)
      headers: {
        request: {
          set: { "X-Forwarded-For": ["{http.request.remote.host}"] },
          delete: ["Forwarded", "X-Real-IP"],
        },
      },
      ...(http.sse ? { flush_interval: -1 } : {}),
      ...(http.websocket ? { stream_close_delay: STREAM_SCHLIESSEN_NACH } : {}),
    },
  ],
  terminal: true,
});

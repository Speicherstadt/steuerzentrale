import { AGENT_PFADE } from "@steuerzentrale/manifest";
import type { MiddlewareHandler } from "hono";
import type { AccessPruefung } from "./jwt.ts";

/*
 * The interface behind Cloudflare Access (BAULISTE.md Z-1104): with STEUERZENTRALE_ACCESS_TEAM and
 * STEUERZENTRALE_ACCESS_AUD every request for the interface and the API needs a valid
 * `Cf-Access-Jwt-Assertion` (jwt.ts), or it gets 403 before any route; the own login with its second
 * factor stays behind it. The paths of agent.<domain> stay as they are (AGENT_PFADE, what the Pforte
 * opens there, packages/manifest): agents and install.sh reach the Zentrale directly, with mTLS at
 * the Pforte, not through Cloudflare. The token is never logged, only why it was refused.
 */

export const ACCESS_KOPF = "cf-access-jwt-assertion";

/** Whether the path is one of agent.<domain>: exact, or below a `/*` */
export const agentPfad = (pfad: string): boolean =>
  AGENT_PFADE.some((p) => (p.endsWith("/*") ? pfad.startsWith(p.slice(0, -1)) : pfad === p));

export const accessWache =
  (
    pruefen: (token: string | null) => Promise<AccessPruefung>,
    log: (zeile: string) => void,
  ): MiddlewareHandler =>
  async (c, next) => {
    if (agentPfad(new URL(c.req.url).pathname)) return next();
    const r = await pruefen(c.req.header(ACCESS_KOPF) ?? null);
    if (r.ok) return next();
    log(JSON.stringify({ msg: "cloudflare access refused", grund: r.grund }));
    return c.json({ fehler: "access" }, 403);
  };

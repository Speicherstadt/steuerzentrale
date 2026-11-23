import { z } from "zod";
import type { Schluesselbund } from "./db/schluessel.ts";
import { CLOUDFLARE_API } from "./modules/dns/cloudflare.ts";
import { type Schluessel, schluesselAus } from "./modules/geheim/verschluesseln.ts";

const HINWEIS = "32 random bytes in base64 (openssl rand -base64 32)";

/** A key variable: parsed to a key, with a message that names the variable and never its value */
const schluesselFeld = (name: string) =>
  z.string({ error: `${name} is missing: ${HINWEIS}` }).transform((wert, ctx): Schluessel => {
    const geparst = schluesselAus(wert.trim());
    if (geparst.ok) return geparst.schluessel;
    ctx.addIssue({ code: "custom", message: `${name} must be ${HINWEIS}` });
    return z.NEVER;
  });

/** An http(s) origin without a path, with a message that names the variable and what it is for */
const originFeld = (name: string, wozu: string) =>
  z.string({ error: `${name} is missing: ${wozu}` }).transform((wert, ctx) => {
    const geparst = URL.parse(wert.trim());
    if (
      geparst &&
      /^https?:$/.test(geparst.protocol) &&
      geparst.pathname === "/" &&
      !geparst.search
    )
      return geparst.origin;
    ctx.addIssue({ code: "custom", message: `${name} must be an http(s) origin without a path` });
    return z.NEVER;
  });

/**
 * Where the interface is reached, as people type it in the browser: Better Auth's origin and the
 * domain passkeys are bound to (rpID), so it has no default; the origin alone, no path
 */
const urlFeld = originFeld(
  "STEUERZENTRALE_URL",
  "where the interface is reached, e.g. https://zentrale.example.de",
);

/**
 * Where agents reach the Zentrale, `agent.<domain>` (docs/plan.md, "Wo die Zentrale läuft"): the
 * install command and the script name it, so it has no default either
 */
const agentUrlFeld = originFeld(
  "STEUERZENTRALE_AGENT_URL",
  "where agents reach the Zentrale, e.g. https://agent.example.de",
);

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Cloudflare's API in tests only (docs/plan.md, "DNS über Cloudflare"): the stand-in
 * (testhilfen/cloudflare.ts) on this machine. Any other host is refused, so the variable cannot send
 * an operator's DNS token anywhere but to Cloudflare.
 */
const cloudflareFeld = z
  .string()
  .optional()
  .transform((wert, ctx) => {
    if (wert === undefined || wert.trim() === "") return CLOUDFLARE_API;
    const geparst = URL.parse(wert.trim());
    if (geparst && /^https?:$/.test(geparst.protocol) && LOOPBACK.has(geparst.hostname))
      return geparst.href.replace(/\/$/, "");
    ctx.addIssue({
      code: "custom",
      message: "STEUERZENTRALE_CLOUDFLARE_API is for tests only and must name localhost",
    });
    return z.NEVER;
  });

/**
 * The test registry in tests only (docs/plan.md, "Versionen aus den Registries (Z-501)"): the
 * stand-in (testhilfen/registry.ts) or CI's registry on localhost, over plain HTTP, in place of
 * every registry. Any other host is refused, so the variable cannot send the queries elsewhere.
 */
const registryFeld = z
  .string()
  .optional()
  .transform((wert, ctx) => {
    if (wert === undefined || wert.trim() === "") return undefined;
    const geparst = URL.parse(wert.trim());
    if (geparst && geparst.protocol === "http:" && LOOPBACK.has(geparst.hostname))
      return geparst.origin;
    ctx.addIssue({
      code: "custom",
      message: "STEUERZENTRALE_REGISTRY_HTTP is for tests only and must be http://localhost…",
    });
    return z.NEVER;
  });

/** The settings of the Zentrale from the environment; dev uses port 18300 (CLAUDE.md, "Working rules") */
const EnvSchema = z.object({
  STEUERZENTRALE_PORT: z.coerce.number().int().min(1).max(65535).default(8300),
  STEUERZENTRALE_HOST: z.string().min(1).default("127.0.0.1"),
  STEUERZENTRALE_DATA: z.string().min(1).default("data"),
  STEUERZENTRALE_URL: urlFeld,
  STEUERZENTRALE_AGENT_URL: agentUrlFeld,
  // The install script, the agent binaries and their signed checksums (scripts/agent-dateien.ts)
  STEUERZENTRALE_AGENT_DATEIEN: z.string().min(1).optional(),
  // The built interface (apps/web/dist); the image of the Zentrale sets it (Z-1004)
  STEUERZENTRALE_WEB: z.string().min(1).optional(),
  STEUERZENTRALE_SECRET_KEY: schluesselFeld("STEUERZENTRALE_SECRET_KEY"),
  // The previous key, only while rotating (`steuerzentrale schluessel-rotieren`)
  STEUERZENTRALE_SECRET_KEY_ALT: schluesselFeld("STEUERZENTRALE_SECRET_KEY_ALT").optional(),
  STEUERZENTRALE_CLOUDFLARE_API: cloudflareFeld,
  STEUERZENTRALE_REGISTRY_HTTP: registryFeld,
  // The check from outside (Z-704); `aus` only where the hosts are made up (e2e)
  STEUERZENTRALE_AUSSEN_PRUEFUNG: z
    .enum(["an", "aus"], { error: "STEUERZENTRALE_AUSSEN_PRUEFUNG must be an or aus" })
    .default("an"),
});

/** `dataDir` holds the database `zentrale.db`; created on the first start */
export type Env = {
  port: number;
  host: string;
  dataDir: string;
  url: string;
  agentUrl: string;
  /** Unset: no install script and no binaries are served (the start logs it) */
  agentDateien: string | undefined;
  /** The built interface; unset: it is served elsewhere (Vite in development) */
  web: string | undefined;
  schluessel: Schluesselbund;
  /** Cloudflare's API, https://api.cloudflare.com/client/v4 but in tests */
  cloudflareApi: string;
  /** The test registry in place of every registry; unset outside tests */
  registryHttp: string | undefined;
  /** Whether the Zentrale checks the installations' public addresses (Z-704) */
  aussenPruefung: boolean;
};

export const parseEnv = (env: Record<string, string | undefined>): Env => {
  const parsed = EnvSchema.parse(env);
  const alt = parsed.STEUERZENTRALE_SECRET_KEY_ALT;
  return {
    port: parsed.STEUERZENTRALE_PORT,
    host: parsed.STEUERZENTRALE_HOST,
    dataDir: parsed.STEUERZENTRALE_DATA,
    url: parsed.STEUERZENTRALE_URL,
    agentUrl: parsed.STEUERZENTRALE_AGENT_URL,
    agentDateien: parsed.STEUERZENTRALE_AGENT_DATEIEN,
    web: parsed.STEUERZENTRALE_WEB,
    schluessel: { aktuell: parsed.STEUERZENTRALE_SECRET_KEY, alt: alt ? [alt] : [] },
    cloudflareApi: parsed.STEUERZENTRALE_CLOUDFLARE_API,
    registryHttp: parsed.STEUERZENTRALE_REGISTRY_HTTP,
    aussenPruefung: parsed.STEUERZENTRALE_AUSSEN_PRUEFUNG === "an",
  };
};

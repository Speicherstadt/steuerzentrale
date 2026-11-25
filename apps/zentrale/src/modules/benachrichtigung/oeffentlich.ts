import { isIPv4, isIPv6 } from "node:net";
import type { Gesendet } from "./smtp.ts";

/*
 * A POST to an address the operator entered (BAULISTE.md Z-703, Z-1105; docs/benachrichtigungen.md),
 * for webhooks and ntfy: the Zentrale must not become a way into its own network. The host is
 * resolved once, every address must be public (no loopback, private, CGNAT, link-local, 0/8,
 * multicast; IPv6 in 2000::/3 only, the rule of Z-704's check from outside), and the request goes to
 * the checked address with the host as Host header and TLS name, so a second answer of DNS cannot
 * point elsewhere. No redirect is followed; only a 2xx counts as delivered. `name` starts every error.
 */

export type Aufloesen = (host: string) => Promise<string[]>;

export type WebhookDeps = {
  fetch: typeof fetch;
  aufloesen: Aufloesen;
  /** Which addresses may be reached; public ones only, anything else only in tests */
  adresseErlaubt: (ip: string) => boolean;
  /** https only; plain http only in tests */
  nurHttps: boolean;
  zeitlimitMs: number;
  /** A CA to trust instead of the system's, only in tests */
  ca?: string;
};

/** The addresses of a host; an IP literal stands for itself */
const adressenVon = async (deps: WebhookDeps, host: string): Promise<string[]> => {
  const ohneKlammern = host.replace(/^\[(.*)\]$/, "$1");
  if (isIPv4(ohneKlammern) || isIPv6(ohneKlammern)) return [ohneKlammern];
  return deps.aufloesen(host);
};

const fehlerVon = (name: string, f: unknown): string => {
  const e = f as { name?: string; code?: string };
  if (e?.name === "TimeoutError") return `${name} time limit`;
  return `${name} connection: ${e?.code ?? e?.name ?? "error"}`;
};

/** Where the request goes: the checked address, or why there is none */
const zielAdresse = async (
  deps: WebhookDeps,
  url: URL,
  name: string,
): Promise<{ ok: true; ip: string } | { ok: false; fehler: string }> => {
  if (url.protocol !== "https:" && (deps.nurHttps || url.protocol !== "http:"))
    return { ok: false, fehler: `${name}: https only` };
  const adressen = await adressenVon(deps, url.hostname).catch(() => [] as string[]);
  if (adressen.length === 0) return { ok: false, fehler: `${name}: host does not resolve` };
  if (!adressen.every(deps.adresseErlaubt))
    return { ok: false, fehler: `${name}: address not public` };
  return { ok: true, ip: adressen[0] ?? "" };
};

/** Posts `body` with `kopf` to `url` at its checked address; never throws */
export const oeffentlichPosten = async (
  deps: WebhookDeps,
  name: string,
  url: URL,
  kopf: Record<string, string>,
  body: string,
): Promise<Gesendet> => {
  const adresse = await zielAdresse(deps, url, name);
  if (!adresse.ok) return adresse;
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  const ip = isIPv6(adresse.ip) ? `[${adresse.ip}]` : adresse.ip;
  const an = `${url.protocol}//${ip}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  try {
    const antwort = await deps.fetch(an, {
      method: "POST",
      headers: { host, "user-agent": "Steuerzentrale", ...kopf },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(deps.zeitlimitMs),
      tls: { serverName: url.hostname, ...(deps.ca ? { ca: deps.ca } : {}) },
    } as RequestInit);
    await antwort.body?.cancel();
    return antwort.status >= 200 && antwort.status < 300
      ? { ok: true }
      : { ok: false, fehler: `${name} HTTP ${antwort.status}` };
  } catch (f) {
    return { ok: false, fehler: fehlerVon(name, f) };
  }
};

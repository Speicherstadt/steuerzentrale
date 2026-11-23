import { isIPv4, isIPv6 } from "node:net";
import { SIGNATUR_HEADER, signieren, ZUSTELLUNG_HEADER } from "./signatur.ts";
import type { Gesendet } from "./smtp.ts";

/*
 * Sending a webhook (BAULISTE.md Z-703; docs/benachrichtigungen.md): a POST of JSON, signed with
 * the recipient's key, with the delivery's id as idempotency key. The URL is the operator's input,
 * so the Zentrale must not become a way into its own network: the host is resolved once, every
 * address must be public (no loopback, private, CGNAT, link-local, 0/8, multicast; IPv6 in
 * 2000::/3 only, the rule of Z-704's check from outside), and the request goes to the checked
 * address with the host as Host header and TLS name, so a second answer of DNS cannot point
 * elsewhere. No redirect is followed; only a 2xx counts as delivered.
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

export type WebhookZiel = { url: string; schluessel: string };

/** The addresses of a host; an IP literal stands for itself */
const adressenVon = async (deps: WebhookDeps, host: string): Promise<string[]> => {
  const ohneKlammern = host.replace(/^\[(.*)\]$/, "$1");
  if (isIPv4(ohneKlammern) || isIPv6(ohneKlammern)) return [ohneKlammern];
  return deps.aufloesen(host);
};

const fehlerVon = (f: unknown): string => {
  const e = f as { name?: string; code?: string };
  if (e?.name === "TimeoutError") return "webhook time limit";
  return `webhook connection: ${e?.code ?? e?.name ?? "error"}`;
};

/** Where the request goes: the checked address, or why there is none */
const zielAdresse = async (
  deps: WebhookDeps,
  url: URL,
): Promise<{ ok: true; ip: string } | { ok: false; fehler: string }> => {
  if (url.protocol !== "https:" && (deps.nurHttps || url.protocol !== "http:"))
    return { ok: false, fehler: "webhook: https only" };
  const adressen = await adressenVon(deps, url.hostname).catch(() => [] as string[]);
  if (adressen.length === 0) return { ok: false, fehler: "webhook: host does not resolve" };
  if (!adressen.every(deps.adresseErlaubt))
    return { ok: false, fehler: "webhook: address not public" };
  return { ok: true, ip: adressen[0] ?? "" };
};

/** Posts `body` signed at `jetzt`; never throws, a failure comes back as a value */
export const webhookSenden = async (
  deps: WebhookDeps,
  ziel: WebhookZiel,
  nachricht: { zustellungId: string; body: string },
  jetzt: number,
): Promise<Gesendet> => {
  const url = new URL(ziel.url);
  const adresse = await zielAdresse(deps, url);
  if (!adresse.ok) return adresse;
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  const ip = isIPv6(adresse.ip) ? `[${adresse.ip}]` : adresse.ip;
  const an = `${url.protocol}//${ip}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  try {
    const antwort = await deps.fetch(an, {
      method: "POST",
      headers: {
        host,
        "content-type": "application/json",
        "user-agent": "Steuerzentrale",
        [SIGNATUR_HEADER]: signieren(ziel.schluessel, jetzt, nachricht.body),
        [ZUSTELLUNG_HEADER]: nachricht.zustellungId,
      },
      body: nachricht.body,
      redirect: "manual",
      signal: AbortSignal.timeout(deps.zeitlimitMs),
      tls: { serverName: url.hostname, ...(deps.ca ? { ca: deps.ca } : {}) },
    } as RequestInit);
    await antwort.body?.cancel();
    return antwort.status >= 200 && antwort.status < 300
      ? { ok: true }
      : { ok: false, fehler: `webhook HTTP ${antwort.status}` };
  } catch (f) {
    return { ok: false, fehler: fehlerVon(f) };
  }
};

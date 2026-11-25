import { istLoopback } from "../anmeldung/adresse.ts";

/*
 * Which agent is calling (docs/plan.md, "TLS und Zertifikate"): Caddy, the Pforte of the
 * Zentrale's server, ends TLS on `agent.<domain>`, checks the client certificate against the
 * operators' CAs and passes its SHA-256 fingerprint on in this header to 127.0.0.1. The header
 * counts only from the loopback address; from anywhere else it is the client's own invention.
 * Behind a Cloudflare Tunnel (Z-1104) cloudflared on the same server hands requests on from loopback
 * too, past the Pforte if it is pointed at the Zentrale; Cloudflare puts its own headers on every
 * request through it, and such a request never counts as an agent's.
 */

/** Headers Cloudflare sets on every request through a tunnel (and Access on every one it lets in) */
const CLOUDFLARE_KOEPFE = ["cf-access-jwt-assertion", "cf-connecting-ip", "cf-ray"];

/** Whether the request came through Cloudflare */
export const durchCloudflare = (headers: Headers): boolean =>
  CLOUDFLARE_KOEPFE.some((k) => headers.has(k));
export const FINGERABDRUCK_HEADER = "x-sz-client-fingerabdruck";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The fingerprint of the client certificate, in lower-case hex without separators, or undefined
 * when the request did not come through the Pforte or carries no valid one. Caddy writes the
 * placeholder `{http.request.tls.client.fingerprint}` as lower-case hex; colons and upper case (as
 * OpenSSL prints it) are taken too.
 */
export const agentFingerabdruck = (
  socket: string | undefined,
  kopf: string | null | undefined,
  cloudflare = false,
): string | undefined => {
  if (cloudflare || socket === undefined || !istLoopback(socket) || !kopf) return undefined;
  const wert = kopf.trim().replaceAll(":", "").toLowerCase();
  return SHA256_HEX.test(wert) ? wert : undefined;
};

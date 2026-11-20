import { istLoopback } from "../anmeldung/adresse.ts";

/*
 * Which agent is calling (docs/plan.md, "TLS und Zertifikate"): Caddy, the Pforte of the
 * Zentrale's server, ends TLS on `agent.<domain>`, checks the client certificate against the
 * operators' CAs and passes its SHA-256 fingerprint on in this header to 127.0.0.1. The header
 * counts only from the loopback address; from anywhere else it is the client's own invention.
 */
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
): string | undefined => {
  if (socket === undefined || !istLoopback(socket) || !kopf) return undefined;
  const wert = kopf.trim().replaceAll(":", "").toLowerCase();
  return SHA256_HEX.test(wert) ? wert : undefined;
};

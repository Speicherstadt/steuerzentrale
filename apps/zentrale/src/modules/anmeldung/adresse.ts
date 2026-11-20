/**
 * The client's address, as the rate limit of the sign-in counts it (src/auth/auth.ts). The Zentrale
 * runs behind the Pforte of its server (docs/plan.md, "TLS und Zertifikate"): only a request from
 * the loopback address carries the client's address, in the X-Forwarded-For that Caddy sets, and
 * there the last entry is the one Caddy added. From anywhere else the header is the client's own
 * and counts for nothing, so a client cannot leave its bucket by inventing one.
 */
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

export const istLoopback = (adresse: string): boolean => LOOPBACK.test(adresse);

export const clientAdresse = (
  socket: string | undefined,
  weitergeleitet: string | null | undefined,
): string | undefined => {
  if (socket === undefined || !istLoopback(socket)) return socket;
  const letzte = weitergeleitet
    ?.split(",")
    .map((teil) => teil.trim())
    .filter((teil) => teil !== "")
    .at(-1);
  return letzte ?? socket;
};

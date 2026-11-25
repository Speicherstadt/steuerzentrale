/*
 * The public keys of a Cloudflare Access team (BAULISTE.md Z-1104; Cloudflare docs, "Validate
 * JWTs"): only from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs, its `keys` in JWK
 * (RS256). They are loaded at the first token and kept; a key id they do not know loads them once
 * more, since Access rotates its key every 6 weeks (the previous one stays valid 7 days), but at
 * most once a minute, so tokens with made-up key ids cannot make the Zentrale ask Cloudflare at
 * every request. The team name is a single DNS label, so no value can point the request elsewhere.
 */

/** A team name as Cloudflare One shows it: one lower-case DNS label */
export const teamGueltig = (team: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(team);

export const certsUrl = (team: string): string =>
  `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;

/** Loading the keys again for an unknown key id waits this long after the last load */
export const NEU_LADEN_MS = 60_000;
const ZEITLIMIT_MS = 5_000;
/** Two keys are a few kilobytes; more is not read */
const MAX_BYTES = 256 * 1024;

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export type AccessSchluessel = { finden: (kid: string) => Promise<CryptoKey | undefined> };

export type SchluesselDeps = {
  team: string;
  holen: (url: string, init: RequestInit) => Promise<Response>;
  jetzt: () => number;
};

type Jwk = { kid?: unknown; kty?: unknown; alg?: unknown; n?: unknown; e?: unknown };

const einlesen = async (keys: unknown): Promise<Map<string, CryptoKey>> => {
  const neu = new Map<string, CryptoKey>();
  if (!Array.isArray(keys)) return neu;
  for (const k of keys as Jwk[]) {
    const { kid, kty, alg, n, e } = k;
    if (typeof kid !== "string" || kty !== "RSA" || alg !== "RS256") continue;
    if (typeof n !== "string" || typeof e !== "string") continue;
    try {
      neu.set(
        kid,
        await crypto.subtle.importKey("jwk", { kty, n, e, alg, ext: true }, ALG, false, ["verify"]),
      );
    } catch {
      // a key that does not import verifies nothing
    }
  }
  return neu;
};

const laden = async (deps: SchluesselDeps): Promise<Map<string, CryptoKey> | undefined> => {
  try {
    const antwort = await deps.holen(certsUrl(deps.team), {
      redirect: "error",
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
    if (!antwort.ok) return undefined;
    const text = await antwort.text();
    if (text.length > MAX_BYTES) return undefined;
    return await einlesen((JSON.parse(text) as { keys?: unknown }).keys);
  } catch {
    return undefined;
  }
};

export const accessSchluessel = (deps: SchluesselDeps): AccessSchluessel => {
  let bekannt = new Map<string, CryptoKey>();
  let geladenAm: number | undefined;
  // requests that come while the keys load wait for that load instead of starting another
  let laufend: Promise<void> | undefined;
  return {
    finden: async (kid) => {
      if (laufend) await laufend;
      const da = bekannt.get(kid);
      if (da) return da;
      if (geladenAm !== undefined && deps.jetzt() - geladenAm < NEU_LADEN_MS) return undefined;
      geladenAm = deps.jetzt();
      laufend = laden(deps).then((neu) => {
        // an answer without a usable key is a broken answer, not a rotation: the known keys stay
        if (neu && neu.size > 0) bekannt = neu;
      });
      await laufend;
      laufend = undefined;
      return bekannt.get(kid);
    },
  };
};

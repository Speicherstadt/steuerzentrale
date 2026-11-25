/*
 * For the tests of Cloudflare Access (Z-1104): a key pair of our own in place of the team's, its
 * public key as `/cdn-cgi/access/certs` lists it, and tokens signed with it (RS256), whose claims a
 * test can change one by one.
 */

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export const TEAM = "teufel";
export const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
export const ISS = `https://${TEAM}.cloudflareaccess.com`;

const b64url = (daten: Uint8Array | string) =>
  Buffer.from(typeof daten === "string" ? new TextEncoder().encode(daten) : daten).toString(
    "base64url",
  );

export type Paar = { kid: string; paar: CryptoKeyPair };

export const paarErzeugen = async (kid: string): Promise<Paar> => ({
  kid,
  paar: (await crypto.subtle.generateKey(
    { ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair,
});

/** The answer of `/cdn-cgi/access/certs` with these keys (keys in JWK, as the docs show) */
export const certsAntwort = async (...paare: Paar[]) => ({
  keys: await Promise.all(
    paare.map(async ({ kid, paar }) => {
      const jwk = await crypto.subtle.exportKey("jwk", paar.publicKey);
      return { kid, kty: "RSA", alg: "RS256", use: "sig", e: jwk.e, n: jwk.n };
    }),
  ),
});

/** A token as Access signs it, valid for a minute from `jetzt` (ms) unless the claims say otherwise */
export const tokenSignieren = async (
  p: Paar,
  jetzt: number,
  claims: Record<string, unknown> = {},
  kopf: Record<string, unknown> = {},
) => {
  const s = Math.floor(jetzt / 1000);
  const h = b64url(JSON.stringify({ alg: "RS256", kid: p.kid, typ: "JWT", ...kopf }));
  const n = b64url(
    JSON.stringify({
      aud: [AUD],
      email: "tristan@teufel-it.de",
      exp: s + 60,
      iat: s,
      nbf: s,
      iss: ISS,
      type: "app",
      sub: "7335d417-61da-459d-899c-0a01c76a2f94",
      ...claims,
    }),
  );
  const signatur = await crypto.subtle.sign(
    ALG,
    p.paar.privateKey,
    new TextEncoder().encode(`${h}.${n}`),
  );
  return `${h}.${n}.${b64url(new Uint8Array(signatur))}`;
};

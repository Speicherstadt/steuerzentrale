import { bits, ganzzahl, kontext, menge, oid, pem, sequenz, utf8 } from "./der.ts";

/*
 * The agent's key and its certificate request (PKCS#10, RFC 2986): the key is made on the server
 * and never leaves it; the Zentrale sees only the request and issues the certificate from its CA
 * (docs/plan.md, "TLS und Zertifikate"). ECDSA P-256 with SHA-256, which Caddy's client_auth and
 * Bun's TLS both take.
 */

const ALGORITHMUS = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNATUR = { name: "ECDSA", hash: "SHA-256" } as const;
const ECDSA_MIT_SHA256 = "1.2.840.10045.4.3.2";
const COMMON_NAME = "2.5.4.3";

/** WebCrypto signs ECDSA as r ‖ s (IEEE P1363); X.509 wants SEQUENCE { INTEGER r, INTEGER s } */
export const ecdsaDer = (roh: Uint8Array): Uint8Array => {
  const haelfte = roh.length / 2;
  return sequenz(ganzzahl(roh.subarray(0, haelfte)), ganzzahl(roh.subarray(haelfte)));
};

export type Schluesselpaar = { privat: CryptoKey; oeffentlich: CryptoKey };

export const schluesselErzeugen = async (): Promise<Schluesselpaar> => {
  const paar = await crypto.subtle.generateKey(ALGORITHMUS, true, ["sign", "verify"]);
  return { privat: paar.privateKey, oeffentlich: paar.publicKey };
};

/** The private key as PKCS#8 PEM, the form Bun's TLS options read */
export const privatPem = async (paar: Schluesselpaar): Promise<string> =>
  pem("PRIVATE KEY", new Uint8Array(await crypto.subtle.exportKey("pkcs8", paar.privat)));

/** A certificate request for `name`, signed with the key it carries, as PEM */
export const anfrageErzeugen = async (paar: Schluesselpaar, name: string): Promise<string> => {
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", paar.oeffentlich));
  const subjekt = sequenz(menge(sequenz(oid(COMMON_NAME), utf8(name))));
  const info = sequenz(ganzzahl(new Uint8Array([0])), subjekt, spki, kontext(0));
  const signatur = new Uint8Array(await crypto.subtle.sign(SIGNATUR, paar.privat, info));
  const der = sequenz(info, sequenz(oid(ECDSA_MIT_SHA256)), bits(ecdsaDer(signatur)));
  return pem("CERTIFICATE REQUEST", der);
};

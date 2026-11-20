import * as x509 from "@peculiar/x509";
import { type AgentCa, ALGORITHMUS, zufallsSerie } from "./ca.ts";

/*
 * The agent's client certificate from its request (docs/plan.md, "TLS und Zertifikate"). The
 * request proves that the agent holds the key (its signature); everything else in it is ignored:
 * the subject is the server's id, the use is client authentication only. Caddy checks the
 * certificate against the operator's CA and hands its SHA-256 fingerprint on, by which the Zentrale
 * knows the server (Z-303).
 */
export const ZERTIFIKAT_GUELTIG_MS = 365 * 24 * 3600_000;

export type Ausgestellt = { pem: string; fingerabdruck: string; gueltigBis: number };

export type Anfrage =
  | { ok: true; anfrage: x509.Pkcs10CertificateRequest }
  | { ok: false; grund: "anfrage_ungueltig" };

const istP256 = (algorithmus: Algorithm): boolean =>
  algorithmus.name === "ECDSA" && (algorithmus as EcKeyAlgorithm).namedCurve === "P-256";

/** A PEM request with a valid signature over an ECDSA P-256 key, or why not */
export const anfragePruefen = async (pem: string): Promise<Anfrage> => {
  try {
    const anfrage = new x509.Pkcs10CertificateRequest(pem);
    if (!istP256(anfrage.publicKey.algorithm)) return { ok: false, grund: "anfrage_ungueltig" };
    if (!(await anfrage.verify())) return { ok: false, grund: "anfrage_ungueltig" };
    return { ok: true, anfrage };
  } catch {
    return { ok: false, grund: "anfrage_ungueltig" };
  }
};

/** The SHA-256 of a certificate's DER bytes in lower-case hex, as Caddy's placeholder gives it */
export const fingerabdruck = async (zertifikat: x509.X509Certificate): Promise<string> =>
  Buffer.from(await zertifikat.getThumbprint("SHA-256")).toString("hex");

export const zertifikatAusstellen = async (
  ca: AgentCa,
  anfrage: x509.Pkcs10CertificateRequest,
  serverId: string,
  jetzt: number,
): Promise<Ausgestellt> => {
  const gueltigBis = jetzt + ZERTIFIKAT_GUELTIG_MS;
  const zertifikat = await x509.X509CertificateGenerator.create({
    subject: [{ CN: [serverId] }],
    issuer: ca.zertifikat.subject,
    publicKey: anfrage.publicKey,
    signingKey: ca.schluessel,
    signingAlgorithm: ALGORITHMUS,
    serialNumber: zufallsSerie(),
    notBefore: new Date(jetzt),
    notAfter: new Date(gueltigBis),
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth]),
      await x509.AuthorityKeyIdentifierExtension.create(ca.zertifikat),
    ],
  });
  return {
    pem: zertifikat.toString("pem"),
    fingerabdruck: await fingerabdruck(zertifikat),
    gueltigBis,
  };
};

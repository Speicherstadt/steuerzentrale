import * as x509 from "@peculiar/x509";
import { BeitrittAntwort, PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import type { TestServer } from "./server.ts";

/*
 * Certificates for the connection tests: the Pforte's server certificate for 127.0.0.1 from a test
 * CA of its own, and an agent that joined through the API with a key the test holds (the real agent
 * makes its own, apps/agent/src/beitritt).
 */
const P256 = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const TAG = 24 * 3600_000;

const pem = (art: string, der: ArrayBuffer) =>
  `-----BEGIN ${art}-----\n${Buffer.from(der)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .trim()}\n-----END ${art}-----\n`;

const paar = async () =>
  (await crypto.subtle.generateKey(P256, true, ["sign", "verify"])) as CryptoKeyPair;

const privatPem = async (schluessel: CryptoKey) =>
  pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", schluessel));

/** A CA and a server certificate for 127.0.0.1 and localhost, valid around `jetzt` */
export const pforteTls = async (jetzt = Date.now()) => {
  const caPaar = await paar();
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    name: "CN=Test-Pforte CA",
    keys: caPaar,
    signingAlgorithm: P256,
    serialNumber: "01",
    notBefore: new Date(jetzt - TAG),
    notAfter: new Date(jetzt + TAG),
    extensions: [new x509.BasicConstraintsExtension(true, 0, true)],
  });
  const serverPaar = await paar();
  const zertifikat = await x509.X509CertificateGenerator.create({
    subject: "CN=localhost",
    issuer: ca.subject,
    publicKey: serverPaar.publicKey,
    signingKey: caPaar.privateKey,
    signingAlgorithm: P256,
    serialNumber: "02",
    notBefore: new Date(jetzt - TAG),
    notAfter: new Date(jetzt + TAG),
    extensions: [
      new x509.SubjectAlternativeNameExtension([
        { type: "dns", value: "localhost" },
        { type: "ip", value: "127.0.0.1" },
      ]),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
    ],
  });
  return {
    ca: ca.toString("pem"),
    zertifikat: zertifikat.toString("pem"),
    schluessel: await privatPem(serverPaar.privateKey),
  };
};

/** A key and its certificate request for an agent, as the agent makes them */
export const agentAnfrage = async () => {
  const keys = await paar();
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: "CN=steuerzentrale-agent",
    keys,
    signingAlgorithm: P256,
  });
  return { csr: csr.toString("pem"), schluessel: await privatPem(keys.privateKey) };
};

/** Joins a server with `token` through the API: what the agent keeps (key, certificate, CA) */
export const agentBeitreten = async (server: TestServer, token: string) => {
  const { csr, schluessel } = await agentAnfrage();
  const { status, daten } = await server.browser().json("/api/v1/agent/beitreten", {
    body: { protokoll: PROTOKOLL_VERSION, token, csr, agentVersion: VERSION, architektur: "amd64" },
  });
  if (status !== 201) throw new Error(`join ${status}`);
  const antwort = BeitrittAntwort.parse(daten);
  return { ...antwort, schluessel };
};

/** The SHA-256 of a PEM certificate, as the Zentrale stores it */
export const fingerabdruckVon = async (zertifikatPem: string) =>
  Buffer.from(await new x509.X509Certificate(zertifikatPem).getThumbprint("SHA-256")).toString(
    "hex",
  );

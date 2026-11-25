import * as x509 from "@peculiar/x509";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { schreiben } from "../audit/index.ts";
import { geheimnisLesen, geheimnisSetzen } from "../geheim/index.ts";

/*
 * The Agent-CA that issues the agents' client certificates (docs/plan.md, "TLS und Zertifikate"),
 * the one operator's (Z-1208): its key lies encrypted in `geheimnisse` like every other secret of the
 * operator (rotated with the key, recorded in the audit log only as changed). The Pforte of the
 * Zentrale trusts exactly this CA.
 */
export const CA_GEHEIMNIS = "agent-ca";
export const ALGORITHMUS = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const CA_GUELTIG_MS = 10 * 365 * 24 * 3600_000;

export type AgentCa = { schluessel: CryptoKey; zertifikat: x509.X509Certificate };

type Gespeichert = { schluessel: string; zertifikat: string };

export const zufallsSerie = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // positive, as RFC 5280 (4.1.2.2) asks of a serial number
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  return Buffer.from(bytes).toString("hex");
};

const caErzeugen = async (betreiberId: string, jetzt: number): Promise<Gespeichert> => {
  const paar = (await crypto.subtle.generateKey(ALGORITHMUS, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const zertifikat = await x509.X509CertificateGenerator.createSelfSigned({
    name: [{ CN: ["Steuerzentrale Agent-CA"] }, { O: [betreiberId] }],
    keys: paar,
    signingAlgorithm: ALGORITHMUS,
    serialNumber: zufallsSerie(),
    notBefore: new Date(jetzt),
    notAfter: new Date(jetzt + CA_GUELTIG_MS),
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(paar.publicKey),
    ],
  });
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", paar.privateKey);
  return {
    schluessel: Buffer.from(pkcs8).toString("base64"),
    zertifikat: zertifikat.toString("pem"),
  };
};

const lesen = (db: Db, bund: Schluesselbund, betreiberId: string): Gespeichert | undefined => {
  const gelesen = geheimnisLesen(db, bund, betreiberId, CA_GEHEIMNIS);
  if (!gelesen.ok) {
    if (gelesen.grund === "fehlt") return undefined;
    throw new Error(`the agent CA of ${betreiberId} does not open: ${gelesen.grund}`);
  }
  return JSON.parse(gelesen.wert) as Gespeichert;
};

const alsCa = async (gespeichert: Gespeichert): Promise<AgentCa> => ({
  schluessel: await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(gespeichert.schluessel, "base64"),
    { name: ALGORITHMUS.name, namedCurve: ALGORITHMUS.namedCurve },
    false,
    ["sign"],
  ),
  zertifikat: new x509.X509Certificate(gespeichert.zertifikat),
});

/**
 * The operator's CA, made on first use. Making a key waits for WebCrypto, so two requests may both
 * make one; the write runs synchronously and keeps whichever came first, so every certificate is
 * issued by the CA that stays.
 */
export const agentCa = async (
  db: Db,
  schreibDb: SchreibDb,
  bund: Schluesselbund,
  kontext: { betreiberId: string; akteur: string; jetzt: number },
): Promise<AgentCa> => {
  const vorhanden = lesen(db, bund, kontext.betreiberId);
  if (vorhanden) return alsCa(vorhanden);
  const neu = await caErzeugen(kontext.betreiberId, kontext.jetzt);
  const gewonnen =
    lesen(db, bund, kontext.betreiberId) ??
    schreiben(schreibDb, { ...kontext, grund: "Agent-CA" }, "agent-ca.anlegen", (s) => {
      geheimnisSetzen(s, bund, {
        betreiberId: kontext.betreiberId,
        geheimnisId: CA_GEHEIMNIS,
        zweck: CA_GEHEIMNIS,
        klartext: JSON.stringify(neu),
        jetzt: kontext.jetzt,
      });
      return neu;
    });
  return alsCa(gewonnen);
};

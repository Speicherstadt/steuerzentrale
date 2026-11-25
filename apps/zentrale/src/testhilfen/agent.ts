import * as x509 from "@peculiar/x509";
import type { BeitrittAnfrage } from "@steuerzentrale/protokoll";
import type { Browser } from "./browser.ts";

/** What a test gives to the interface's dialog: a shared server, maintenance 03:30 to 04:30 */
export const NEUER_SERVER = {
  name: "Gemeinsamer Server 3",
  wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], von: "03:30", bis: "04:30" },
  grund: "neuer Server",
};

/** Adds a server as `person`; its id and the one-time token from the command */
export const serverHinzufuegen = async (person: Pick<Browser, "json">, angaben = NEUER_SERVER) => {
  const { status, daten } = await person.json("/api/v1/server", { body: angaben });
  if (status !== 201) throw new Error(`server ${status} ${JSON.stringify(daten)}`);
  const antwort = daten as { serverId: string; befehl: string; gueltigBis: number };
  const token = /--token (\S+)/.exec(antwort.befehl)?.[1] ?? "";
  return { ...antwort, token };
};

const P256 = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

/** A certificate request as an agent sends it, made with @peculiar/x509 (the agent has its own) */
export const testAnfrage = async (
  token: string,
  algorithmus: EcKeyGenParams | RsaHashedKeyGenParams = P256,
): Promise<BeitrittAnfrage> => {
  const keys = (await crypto.subtle.generateKey(algorithmus, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: "CN=steuerzentrale-agent",
    keys,
    signingAlgorithm: "hash" in algorithmus ? { ...algorithmus } : P256,
  });
  return {
    protokoll: 1,
    token,
    csr: csr.toString("pem"),
    agentVersion: "0.0.0",
    architektur: "amd64",
  };
};

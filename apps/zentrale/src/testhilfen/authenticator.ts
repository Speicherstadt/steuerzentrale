import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";

/**
 * A software passkey for tests without a browser (WebAuthn Level 2: attestation "none", ES256):
 * enough to register a passkey with Better Auth and sign in with it. The browser's virtual
 * authenticator follows in Playwright with the pages.
 */
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

const kopf = (art: number, laenge: number): number[] => {
  if (laenge < 24) return [(art << 5) | laenge];
  if (laenge < 256) return [(art << 5) | 24, laenge];
  return [(art << 5) | 25, laenge >> 8, laenge & 255];
};

const cbor = (wert: Cbor): Buffer => {
  if (typeof wert === "number") return Buffer.from(wert >= 0 ? kopf(0, wert) : kopf(1, -1 - wert));
  if (typeof wert === "string") {
    const text = Buffer.from(wert, "utf8");
    return Buffer.concat([Buffer.from(kopf(3, text.length)), text]);
  }
  if (wert instanceof Uint8Array) return Buffer.concat([Buffer.from(kopf(2, wert.length)), wert]);
  const teile = [...wert].flatMap(([schluessel, inhalt]) => [cbor(schluessel), cbor(inhalt)]);
  return Buffer.concat([Buffer.from(kopf(5, wert.size)), ...teile]);
};

const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const sha256 = (daten: Uint8Array | string): Buffer => createHash("sha256").update(daten).digest();

const zaehlerBytes = (zaehler: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(zaehler);
  return bytes;
};

/** The public key as COSE_Key (RFC 8152): EC2, ES256, P-256 */
const coseSchluessel = (oeffentlich: KeyObject): Buffer => {
  const jwk = oeffentlich.export({ format: "jwk" });
  return cbor(
    new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? "", "base64url")],
      [-3, Buffer.from(jwk.y ?? "", "base64url")],
    ]),
  );
};

export type Optionen = { challenge: string; rp?: { id?: string }; rpId?: string };

export const authenticator = (origin: string) => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kennung = randomBytes(16);
  const rpId = new URL(origin).hostname;
  let zaehler = 0;
  const clientDaten = (typ: string, challenge: string) =>
    Buffer.from(JSON.stringify({ type: typ, challenge, origin, crossOrigin: false }), "utf8");

  const registrieren = (optionen: Optionen) => {
    const authDaten = Buffer.concat([
      sha256(optionen.rp?.id ?? rpId),
      Buffer.from([0x45]),
      zaehlerBytes(zaehler),
      Buffer.alloc(16),
      Buffer.from([kennung.length >> 8, kennung.length & 255]),
      kennung,
      coseSchluessel(publicKey),
    ]);
    const attestierung = cbor(
      new Map<Cbor, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authDaten],
      ]),
    );
    return {
      id: b64u(kennung),
      rawId: b64u(kennung),
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientDaten("webauthn.create", optionen.challenge)),
        attestationObject: b64u(attestierung),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  };

  const anmelden = (optionen: Optionen) => {
    zaehler += 1;
    const authDaten = Buffer.concat([
      sha256(optionen.rpId ?? rpId),
      Buffer.from([0x05]),
      zaehlerBytes(zaehler),
    ]);
    const daten = clientDaten("webauthn.get", optionen.challenge);
    const signatur = sign("sha256", Buffer.concat([authDaten, sha256(daten)]), privateKey);
    return {
      id: b64u(kennung),
      rawId: b64u(kennung),
      type: "public-key",
      response: {
        clientDataJSON: b64u(daten),
        authenticatorData: b64u(authDaten),
        signature: b64u(signatur),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  };

  return { registrieren, anmelden };
};

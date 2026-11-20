import { createHmac } from "node:crypto";

/**
 * An authenticator app for tests: the TOTP of RFC 6238 (HMAC-SHA1, 30 s, 6 digits), written here
 * from the RFC rather than taken from Better Auth, so the test checks Better Auth against the
 * standard and not against itself
 */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Bytes = (text: string): Buffer => {
  let bits = "";
  for (const zeichen of text.replace(/=+$/, "").toUpperCase())
    bits += BASE32.indexOf(zeichen).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
};

/** The secret of an otpauth:// URI as the key bytes */
export const totpSchluessel = (uri: string): Buffer => {
  const geheimnis = new URL(uri).searchParams.get("secret");
  if (!geheimnis) throw new Error("otpauth URI without secret");
  return base32Bytes(geheimnis);
};

export const totpCode = (schluessel: Buffer, zeit = Date.now()): string => {
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(Math.floor(zeit / 30_000)));
  const hmac = createHmac("sha1", schluessel).update(zaehler).digest();
  const versatz = (hmac.at(-1) ?? 0) & 15;
  const zahl = hmac.readUInt32BE(versatz) & 0x7fffffff;
  return String(zahl % 1_000_000).padStart(6, "0");
};

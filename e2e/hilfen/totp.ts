import { createHmac } from "node:crypto";

/** The TOTP of RFC 6238 (HMAC-SHA1, 30 s, 6 digits) from a base32 key, as an authenticator app */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const totpCode = (geheimnis: string, zeit = Date.now()): string => {
  const bits = [...geheimnis.replace(/=+$/, "").toUpperCase()]
    .map((zeichen) => BASE32.indexOf(zeichen).toString(2).padStart(5, "0"))
    .join("");
  const schluessel = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(Math.floor(zeit / 30_000)));
  const hmac = createHmac("sha1", schluessel).update(zaehler).digest();
  const versatz = (hmac.at(-1) ?? 0) & 15;
  return String((hmac.readUInt32BE(versatz) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

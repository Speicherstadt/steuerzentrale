import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/*
 * Encrypted columns (docs/entwicklung.md): AES-256-GCM with the key from STEUERZENTRALE_SECRET_KEY.
 * Every value carries the id of its key, so the key can be rotated; the purpose (table, operator and
 * row) and the key id are the additional data, so a value cannot be moved into another row.
 * Stored as "v1.<key id>." + base64url(nonce ‖ tag ‖ ciphertext). Modelled on Speicherstadt/soll,
 * apps/server/src/modules/geheim.
 */
const VERSION = "v1";
const NONCE = 12;
const TAG = 16;
const LAENGE = 32;

export type Schluessel = { readonly id: string; readonly bytes: Uint8Array };

/** The id of a key: the first 8 hex digits of its SHA-256, which reveal nothing usable about it */
export const schluesselId = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 8);

export const schluesselAus = (
  base64: string,
): { ok: true; schluessel: Schluessel } | { ok: false } => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false };
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.length !== LAENGE) return { ok: false };
  return { ok: true, schluessel: { id: schluesselId(bytes), bytes } };
};

const zusatz = (zweck: string, id: string) => Buffer.from(`${zweck}\n${id}`, "utf8");

export const verschluesseln = (schluessel: Schluessel, zweck: string, klartext: string): string => {
  const nonce = randomBytes(NONCE);
  const chiffre = createCipheriv("aes-256-gcm", schluessel.bytes, nonce);
  chiffre.setAAD(zusatz(zweck, schluessel.id));
  const text = Buffer.concat([chiffre.update(klartext, "utf8"), chiffre.final()]);
  const roh = Buffer.concat([nonce, chiffre.getAuthTag(), text]).toString("base64url");
  return `${VERSION}.${schluessel.id}.${roh}`;
};

export type Entschluesselt =
  | { ok: true; wert: string }
  | { ok: false; grund: "kein_geheimnis" | "unbekannter_schluessel" | "ungueltig" };

/** The id of the key a stored value was encrypted with, or undefined for anything else */
export const schluesselIdVon = (wert: string): string | undefined => {
  const [version, id] = wert.split(".");
  return version === VERSION && id && /^[0-9a-f]{8}$/.test(id) ? id : undefined;
};

/** The plain text, with whichever of `schluessel` the value names; errors as values */
export const entschluesseln = (
  schluessel: readonly Schluessel[],
  zweck: string,
  wert: string,
): Entschluesselt => {
  const id = schluesselIdVon(wert);
  if (id === undefined) return { ok: false, grund: "kein_geheimnis" };
  const passend = schluessel.find((kandidat) => kandidat.id === id);
  if (!passend) return { ok: false, grund: "unbekannter_schluessel" };
  const roh = Buffer.from(wert.slice(VERSION.length + id.length + 2), "base64url");
  if (roh.length < NONCE + TAG) return { ok: false, grund: "ungueltig" };
  try {
    const entschluessler = createDecipheriv("aes-256-gcm", passend.bytes, roh.subarray(0, NONCE));
    entschluessler.setAAD(zusatz(zweck, id));
    entschluessler.setAuthTag(roh.subarray(NONCE, NONCE + TAG));
    const text = Buffer.concat([
      entschluessler.update(roh.subarray(NONCE + TAG)),
      entschluessler.final(),
    ]);
    return { ok: true, wert: text.toString("utf8") };
  } catch {
    return { ok: false, grund: "ungueltig" };
  }
};

/**
 * Signs files in the minisign format with an unencrypted secret key (`minisign -G -W`). Only for the
 * public test key in test/schluessel/ (docs/plan.md, "Signaturen in Tests"): the real key stays
 * offline and signs with minisign itself, and release builds refuse the test key
 * (packages/manifest, vertrauen.ts). Format: jedisct1/minisign, README "Signature format".
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";

export type GeheimerSchluessel = { id: Uint8Array; seed: Uint8Array };

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Reads an unencrypted minisign secret key file; an encrypted one is refused */
export const geheimenSchluesselLesen = (text: string): GeheimerSchluessel => {
  const zeile = text
    .split("\n")
    .find((z) => z.trim() !== "" && !z.startsWith("untrusted comment:"));
  const roh = new Uint8Array(Buffer.from(zeile?.trim() ?? "", "base64"));
  // "Ed" ‖ kdf ‖ "B2" ‖ salt (32) ‖ opslimit (8) ‖ memlimit (8) ‖ key id (8) ‖ secret key (64) ‖ checksum (32)
  if (roh.length !== 158 || String.fromCharCode(roh[0] ?? 0, roh[1] ?? 0) !== "Ed")
    throw new Error("no minisign secret key");
  if (roh[2] !== 0 || roh[3] !== 0)
    throw new Error("the secret key is encrypted; only the test key may sign here");
  return { id: roh.subarray(54, 62), seed: roh.subarray(62, 94) };
};

/** A .minisig file for `inhalt`: prehashed ("ED") signature and the trusted comment's signature */
export const signieren = (
  inhalt: Uint8Array,
  schluessel: GeheimerSchluessel,
  kommentar: string,
): string => {
  if (kommentar.includes("\n")) throw new Error("the trusted comment is one line");
  const signatur = ed25519.sign(blake2b(inhalt, { dkLen: 64 }), schluessel.seed);
  const kopf = new Uint8Array([0x45, 0x44, ...schluessel.id, ...signatur]);
  const global = ed25519.sign(
    new Uint8Array([...signatur, ...new TextEncoder().encode(kommentar)]),
    schluessel.seed,
  );
  return `untrusted comment: signature from the Steuerzentrale test key\n${base64(kopf)}\ntrusted comment: ${kommentar}\n${base64(global)}\n`;
};

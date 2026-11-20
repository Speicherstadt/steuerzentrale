import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";

/*
 * Verifies minisign signatures (docs/plan.md, "Signaturen"): format of jedisct1/minisign
 * (README, "Signature format"). A public key is "Ed" ‖ key id (8) ‖ Ed25519 key (32); a signature
 * file holds "ED" (BLAKE2b-512 prehash) or legacy "Ed" ‖ key id ‖ signature (64), a trusted comment
 * and a global signature over signature ‖ comment. Both signatures must hold. Pure, no I/O.
 */

export type OeffentlicherSchluessel = { id: string; schluessel: Uint8Array };

export type Signiert =
  | { ok: true; schluesselId: string; kommentar: string }
  | { ok: false; grund: string };

const vonBase64 = (text: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return undefined;
  return Uint8Array.from(atob(text), (zeichen) => zeichen.charCodeAt(0));
};

const hex = (bytes: Uint8Array): string =>
  [...bytes]
    .reverse()
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const gleich = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** The key line of a minisign public key file, or the bare base64 line */
export const schluesselLesen = (text: string): OeffentlicherSchluessel | undefined => {
  const zeile = text
    .split("\n")
    .map((z) => z.trim())
    .find((z) => z !== "" && !z.startsWith("untrusted comment:"));
  const roh = zeile ? vonBase64(zeile) : undefined;
  if (roh?.length !== 42 || roh[0] !== 0x45 || roh[1] !== 0x64) return undefined;
  return { id: hex(roh.subarray(2, 10)), schluessel: roh.subarray(10) };
};

const textBytes = (text: string) => new TextEncoder().encode(text);

/** Whether `signatur` (a .minisig file) signs `inhalt` with `schluessel` */
export const signaturPruefen = (
  inhalt: Uint8Array,
  signatur: string,
  schluessel: OeffentlicherSchluessel,
): Signiert => {
  const zeilen = signatur.replace(/\r\n/g, "\n").split("\n");
  if (!zeilen[0]?.startsWith("untrusted comment:"))
    return { ok: false, grund: "no minisign signature" };
  const roh = vonBase64(zeilen[1]?.trim() ?? "");
  const kommentarZeile = zeilen[2] ?? "";
  const global = vonBase64(zeilen[3]?.trim() ?? "");
  if (
    roh?.length !== 74 ||
    !kommentarZeile.startsWith("trusted comment: ") ||
    global?.length !== 64
  )
    return { ok: false, grund: "malformed signature" };
  const algorithmus = String.fromCharCode(roh[0] ?? 0, roh[1] ?? 0);
  if (algorithmus !== "ED" && algorithmus !== "Ed")
    return { ok: false, grund: "unknown signature algorithm" };
  if (!gleich(roh.subarray(2, 10), idBytes(schluessel)))
    return {
      ok: false,
      grund: `signed with key ${hex(roh.subarray(2, 10))}, expected ${schluessel.id}`,
    };
  const sig = roh.subarray(10);
  const nachricht = algorithmus === "ED" ? blake2b(inhalt, { dkLen: 64 }) : inhalt;
  if (!pruefe(sig, nachricht, schluessel.schluessel))
    return { ok: false, grund: "signature does not match" };
  const kommentar = kommentarZeile.slice("trusted comment: ".length);
  const globalNachricht = new Uint8Array([...sig, ...textBytes(kommentar)]);
  if (!pruefe(global, globalNachricht, schluessel.schluessel))
    return { ok: false, grund: "trusted comment signature does not match" };
  return { ok: true, schluesselId: schluessel.id, kommentar };
};

const idBytes = (schluessel: OeffentlicherSchluessel): Uint8Array =>
  new Uint8Array(
    (schluessel.id.match(/../g) ?? []).map((paar) => Number.parseInt(paar, 16)).reverse(),
  );

const pruefe = (sig: Uint8Array, nachricht: Uint8Array, schluessel: Uint8Array): boolean => {
  try {
    return ed25519.verify(sig, nachricht, schluessel);
  } catch {
    return false;
  }
};

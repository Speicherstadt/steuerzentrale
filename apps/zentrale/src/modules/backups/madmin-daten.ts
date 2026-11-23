/*
 * The encrypted bodies of MinIO's admin API (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und Zugang
 * je Installation (Z-601)"): `add-service-account` takes its JSON encrypted with the admin's secret
 * key. Built after minio/madmin-go, encrypt.go (EncryptData, DecryptData; commit 98483d3c6f42) and
 * the stream format of secure-io/sio-go, sio.go and writer.go (commit 2e9ca5aa4469), with Web Crypto
 * and no dependency:
 *
 *   salt (32) | algorithm id (1) | nonce (8) | sio stream
 *
 * The key is PBKDF2-SHA256 of the password over the salt with 8192 rounds, the id 0x02
 * (`pbkdf2AESGCM`), which madmin uses in FIPS mode and every MinIO server decrypts. The sio stream
 * cuts the data into fragments of 16 KiB, each sealed with AES-256-GCM under the nonce
 * `nonce | seq (uint32, little endian)`; seq 0 seals nothing and gives the tag that, behind a flag
 * byte, is the associated data of every fragment; the last fragment has the flag 0x80, all others
 * 0x00. madmin's other ids (Argon2id) are refused when reading: the Zentrale never needs them.
 */

const SALZ_BYTES = 32;
const NONCE_BYTES = 8;
const TAG_BYTES = 16;
const PBKDF2_RUNDEN = 8192;
const PBKDF2_AES_GCM = 0x02;
/** sio.BufSize */
export const FRAGMENT_BYTES = 1 << 14;

const subtle = globalThis.crypto.subtle;

export type Zufall = (n: number) => Uint8Array;
const zufallVonWebCrypto: Zufall = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

const gcmNonce = (nonce: Uint8Array, seq: number): Uint8Array<ArrayBuffer> => {
  const n = new Uint8Array(NONCE_BYTES + 4);
  n.set(nonce);
  new DataView(n.buffer).setUint32(NONCE_BYTES, seq, true);
  return n;
};

const versiegeln = async (
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  daten: Uint8Array<ArrayBuffer>,
  zusatz: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: zusatz }, key, daten));

/** The associated data of the fragments: a flag byte and the tag of sealing nothing under seq 0 */
const zusatzDaten = async (key: CryptoKey, nonce: Uint8Array, aussen: Uint8Array<ArrayBuffer>) => {
  const tag = await versiegeln(key, gcmNonce(nonce, 0), new Uint8Array(0), aussen);
  const zusatz = new Uint8Array(1 + TAG_BYTES);
  zusatz.set(tag, 1);
  return zusatz;
};

/** The fragments of the data: full ones, then the last with 1 to `groesse` bytes (0 if empty) */
const fragmente = (daten: Uint8Array<ArrayBuffer>, groesse: number) => {
  const teile: Uint8Array<ArrayBuffer>[] = [];
  let ab = 0;
  while (daten.length - ab > groesse) {
    teile.push(daten.subarray(ab, ab + groesse));
    ab += groesse;
  }
  teile.push(daten.subarray(ab));
  return teile;
};

const verbinden = (teile: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const ganz = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let ab = 0;
  for (const t of teile) {
    ganz.set(t, ab);
    ab += t.length;
  }
  return ganz;
};

/** A sio stream (sio.Stream.EncryptWriter, written once and closed) */
export const sioVersiegeln = async (
  key: CryptoKey,
  nonce: Uint8Array,
  daten: Uint8Array<ArrayBuffer>,
  aussen: Uint8Array<ArrayBuffer> = new Uint8Array(0),
  groesse = FRAGMENT_BYTES,
): Promise<Uint8Array<ArrayBuffer>> => {
  const zusatz = await zusatzDaten(key, nonce, aussen);
  const teile = fragmente(daten, groesse);
  const versiegelt = await Promise.all(
    teile.map((teil, i) => {
      const z = new Uint8Array(zusatz);
      if (i === teile.length - 1) z[0] = 0x80;
      return versiegeln(key, gcmNonce(nonce, i + 1), teil, z);
    }),
  );
  return verbinden(versiegelt);
};

/** The plain text of a sio stream, or undefined when it is not authentic or cut short */
export const sioOeffnen = async (
  key: CryptoKey,
  nonce: Uint8Array,
  strom: Uint8Array<ArrayBuffer>,
  aussen: Uint8Array<ArrayBuffer> = new Uint8Array(0),
  groesse = FRAGMENT_BYTES,
): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  const zusatz = await zusatzDaten(key, nonce, aussen);
  const teile = fragmente(strom, groesse + TAG_BYTES);
  try {
    const offen = await Promise.all(
      teile.map((teil, i) => {
        const z = new Uint8Array(zusatz);
        if (i === teile.length - 1) z[0] = 0x80;
        return subtle
          .decrypt({ name: "AES-GCM", iv: gcmNonce(nonce, i + 1), additionalData: z }, key, teil)
          .then((b) => new Uint8Array(b));
      }),
    );
    return verbinden(offen);
  } catch {
    return undefined;
  }
};

/** AES-256-GCM key from the password: PBKDF2-SHA256, 8192 rounds (madmin, `pbkdf2Cost`) */
const schluessel = async (passwort: string, salz: Uint8Array<ArrayBuffer>): Promise<CryptoKey> => {
  const basis = await subtle.importKey("raw", new TextEncoder().encode(passwort), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salz, iterations: PBKDF2_RUNDEN },
    basis,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/** madmin.EncryptData with the id `pbkdf2AESGCM` */
export const madminVerschluesseln = async (
  passwort: string,
  klartext: string,
  zufall: Zufall = zufallVonWebCrypto,
): Promise<Uint8Array<ArrayBuffer>> => {
  const salz = new Uint8Array(zufall(SALZ_BYTES));
  const nonce = zufall(NONCE_BYTES);
  const key = await schluessel(passwort, salz);
  const strom = await sioVersiegeln(key, nonce, new TextEncoder().encode(klartext));
  return verbinden([salz, Uint8Array.of(PBKDF2_AES_GCM), nonce, strom]);
};

/** madmin.DecryptData for the id `pbkdf2AESGCM`; undefined for anything else or a wrong password */
export const madminEntschluesseln = async (
  passwort: string,
  daten: Uint8Array<ArrayBuffer>,
): Promise<string | undefined> => {
  const kopf = SALZ_BYTES + 1 + NONCE_BYTES;
  if (daten.length < kopf + TAG_BYTES || daten[SALZ_BYTES] !== PBKDF2_AES_GCM) return undefined;
  const key = await schluessel(passwort, daten.slice(0, SALZ_BYTES));
  const offen = await sioOeffnen(key, daten.slice(SALZ_BYTES + 1, kopf), daten.slice(kopf));
  return offen && new TextDecoder().decode(offen);
};

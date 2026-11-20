/*
 * The few DER encodings a PKCS#10 certificate request needs (ITU-T X.690, section 8 and 10): the
 * agent builds its request itself, so no X.509 library has to run on a managed server
 * (allowed-dependencies.json keeps @peculiar/x509 to the Zentrale). Pure functions on bytes.
 */

/** Bytes backed by a plain ArrayBuffer, as WebCrypto takes them */
export type Bytes = Uint8Array<ArrayBuffer>;

const laenge = (n: number): number[] => {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 | bytes.length, ...bytes];
};

/** One element: tag, length, content */
export const tlv = (tag: number, inhalt: Uint8Array): Bytes =>
  new Uint8Array([tag, ...laenge(inhalt.length), ...inhalt]);

const verbunden = (teile: Uint8Array[]): Bytes => {
  const ergebnis = new Uint8Array(teile.reduce((summe, teil) => summe + teil.length, 0));
  let stelle = 0;
  for (const teil of teile) {
    ergebnis.set(teil, stelle);
    stelle += teil.length;
  }
  return ergebnis;
};

export const sequenz = (...teile: Uint8Array[]): Bytes => tlv(0x30, verbunden(teile));
export const menge = (...teile: Uint8Array[]): Bytes => tlv(0x31, verbunden(teile));
export const utf8 = (text: string): Bytes => tlv(0x0c, new TextEncoder().encode(text));
/** A BIT STRING without unused bits */
export const bits = (inhalt: Uint8Array): Bytes =>
  tlv(0x03, verbunden([new Uint8Array([0]), inhalt]));
/** A context-specific constructed element `[n]`, as an empty attribute set `[0]` */
export const kontext = (n: number, ...teile: Uint8Array[]): Bytes =>
  tlv(0xa0 | n, verbunden(teile));

/** A non-negative INTEGER from big-endian bytes: no leading zeros, one 0x00 before a high bit */
export const ganzzahl = (bytes: Uint8Array): Bytes => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const kern = bytes.subarray(start);
  const vorzeichen = (kern[0] ?? 0) & 0x80 ? [0] : [];
  return tlv(0x02, new Uint8Array([...vorzeichen, ...kern]));
};

/** An OBJECT IDENTIFIER from its dotted form */
export const oid = (punktiert: string): Bytes => {
  const [erste = 0, zweite = 0, ...rest] = punktiert.split(".").map(Number);
  const bogen = (wert: number): number[] => {
    const bytes = [wert % 128];
    for (let r = Math.floor(wert / 128); r > 0; r = Math.floor(r / 128))
      bytes.unshift(0x80 | (r % 128));
    return bytes;
  };
  return tlv(0x06, new Uint8Array([40 * erste + zweite, ...rest.flatMap(bogen)]));
};

export const pem = (art: string, der: Uint8Array): string => {
  const zeilen =
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${art}-----\n${zeilen.join("\n")}\n-----END ${art}-----\n`;
};

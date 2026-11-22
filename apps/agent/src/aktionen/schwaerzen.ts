/*
 * The lines of a log excerpt as they leave the server (BAULISTE.md Z-405; docs/plan.md,
 * "Log-Auszug"): every value of a secret replaced by [geheim], then each line cut to 2000
 * characters, the last 500 lines. Pure, no I/O.
 *
 * Replacing finds every occurrence of every value in the line as read, overlapping ones too, and
 * replaces each run of covered characters once. That is "longer values first" for a value inside
 * another, and it leaves no part of two values that overlap ("abcd" and "cdef" in "abcdef"), which
 * replacing one value after the other would. Nothing is looked for in a replacement, so no value is
 * formed from [geheim] and the text next to it. A line cut off while it was read (zeilen.ts) may
 * end in the first part of a value: from the earliest place where the rest of the line is the start
 * of a value, its end is replaced too. Cutting to 2000 characters comes after replacing, so it
 * never leaves a part of a value behind.
 *
 * A control character (tabs aside) and a lone half of a surrogate pair become U+FFFD: JSON writes
 * them as six bytes (\u0001), anything else takes at most three bytes per UTF-16 unit, so 500 lines
 * of 2000 units stay below 3 MB and always fit into one message (MAX_NACHRICHT_BYTES, 4 MiB).
 */

export const ERSATZ = "[geheim]";
export const MAX_ZEILEN = 500;
export const MAX_ZEICHEN = 2000;

/** A line as read: cut off when it was longer than the reader keeps (zeilen.ts) */
export type GeleseneZeile = { text: string; abgeschnitten: boolean };

type Bereich = readonly [von: number, bis: number];

/**
 * The values to look for: each value, and each line of one with several (journalctl prints every
 * line of a message as a line of its own); never an empty one, which would match everywhere
 */
export const suchwerte = (werte: Iterable<string>): string[] => {
  const alle = new Set<string>();
  for (const wert of werte) {
    if (wert === "") continue;
    alle.add(wert);
    if (wert.includes("\n")) for (const teil of wert.split("\n")) if (teil !== "") alle.add(teil);
  }
  return [...alle];
};

/** Every occurrence of the value, overlapping ones too */
const vorkommen = (text: string, wert: string): Bereich[] => {
  const bereiche: Bereich[] = [];
  for (let i = text.indexOf(wert); i !== -1; i = text.indexOf(wert, i + 1))
    bereiche.push([i, i + wert.length]);
  return bereiche;
};

/** From the earliest place where the rest of the text is the start of a value, to its end */
const angeschnitten = (text: string, werte: readonly string[]): Bereich[] => {
  // the start of a value is no longer than the value
  const laengster = Math.max(0, ...werte.map((w) => w.length));
  for (let i = Math.max(0, text.length - laengster); i < text.length; i++) {
    const rest = text.slice(i);
    if (werte.some((w) => w.startsWith(rest))) return [[i, text.length]];
  }
  return [];
};

/** Overlapping and adjacent ranges as one, in order */
const zusammenfassen = (bereiche: Bereich[]): Bereich[] => {
  const sortiert = [...bereiche].sort((a, b) => a[0] - b[0]);
  const zusammen: [number, number][] = [];
  for (const [von, bis] of sortiert) {
    const letzter = zusammen.at(-1);
    if (letzter && von <= letzter[1]) letzter[1] = Math.max(letzter[1], bis);
    else zusammen.push([von, bis]);
  }
  return zusammen;
};

/** The line with every value of `werte` (suchwerte) replaced by ERSATZ */
export const zeileSchwaerzen = (zeile: GeleseneZeile, werte: readonly string[]): string => {
  const bereiche = werte.flatMap((w) => vorkommen(zeile.text, w));
  if (zeile.abgeschnitten) bereiche.push(...angeschnitten(zeile.text, werte));
  let aus = "";
  let bei = 0;
  for (const [von, bis] of zusammenfassen(bereiche)) {
    aus += zeile.text.slice(bei, von) + ERSATZ;
    bei = bis;
  }
  return aus + zeile.text.slice(bei);
};

const ERSATZZEICHEN = "�";

const istSteuerzeichen = (c: number) => (c < 0x20 && c !== 0x09) || c === 0x7f;
const istHoch = (c: number) => c >= 0xd800 && c <= 0xdbff;
const istTief = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Control characters (tabs aside) and lone halves of surrogate pairs as U+FFFD */
const saeubern = (text: string): string => {
  let aus = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (istHoch(c) && istTief(text.charCodeAt(i + 1))) {
      aus += text.slice(i, i + 2);
      i++;
    } else aus += istSteuerzeichen(c) || istHoch(c) || istTief(c) ? ERSATZZEICHEN : text[i];
  }
  return aus;
};

/** The last 500 lines, values replaced, each cut to 2000 characters */
export const zeilenSchwaerzen = (
  zeilen: readonly GeleseneZeile[],
  werte: readonly string[],
): string[] =>
  zeilen.slice(-MAX_ZEILEN).map((z) => saeubern(zeileSchwaerzen(z, werte).slice(0, MAX_ZEICHEN)));

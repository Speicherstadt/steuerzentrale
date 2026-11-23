/*
 * Entries that continue a split line (review of Z-405). conmon writes a line longer than its buffer
 * as several journal entries (STDIO_BUF_SIZE 8192 in src/config.h, CONTAINER_PARTIAL_MESSAGE in
 * src/ctr_logging.c of containers/conmon), and journald splits a line longer than LineMax (48K by
 * default) alike. A value can so be cut in two: its first part at the end of one entry, which the
 * cut to 2000 characters drops, its rest at the start of the next entry's message. `-o short-iso`
 * does not say which entry continues another, so the message of an entry may continue one when the
 * entry before it from the same source (host and identifier[pid]) was long, or when the excerpt
 * holds none before it. From the start of such a message, the longest text that ends a value is
 * replaced too: after a long entry from one character on; at the first entry of a source, whose
 * entry before lies outside the excerpt, from UNBEKANNT_AB characters on, so that a message that
 * merely starts like the end of a value (the last letter of a password) stays as it is, while at
 * most three characters of a value split right at the edge of the excerpt remain. Pure, no I/O.
 */

type Bereich = readonly [von: number, bis: number];

/** A split entry has at least 8192 bytes (conmon); far below that, so no prefix or edge escapes */
export const LANG_AB_BYTES = 4096;

/** `<time> <host> <identifier>[<pid>]: <message>`; group 1 is the source, the match ends at the message */
const KOPF = /^\S+ (\S+ [^\s:][^:]*?): /;

/** How much of the end of a value counts at the first entry of a source (see above) */
export const UNBEKANNT_AB = 4;

const bytes = new TextEncoder();

/** Where the message of a line starts and how long the end of a value there must at least be */
export type Fortsetzung = { anfang: number; mindestens: number };

/**
 * For each line, where its message starts if it may continue a split entry, else undefined; lines
 * that are no entry of their own (the further lines of a message, "-- No entries --") never do
 */
export const fortsetzungen = (
  zeilen: readonly { text: string; abgeschnitten: boolean }[],
): (Fortsetzung | undefined)[] => {
  const langZuletzt = new Map<string, boolean>();
  return zeilen.map((z) => {
    const kopf = KOPF.exec(z.text);
    if (!kopf) return undefined;
    const quelle = kopf[1] as string;
    const zuletzt = langZuletzt.get(quelle);
    langZuletzt.set(quelle, z.abgeschnitten || bytes.encode(z.text).byteLength >= LANG_AB_BYTES);
    if (zuletzt === false) return undefined;
    return { anfang: kopf[0].length, mindestens: zuletzt ? 1 : UNBEKANNT_AB };
  });
};

/** From the message's start to the end of the longest text there that ends one of the values */
export const fortgesetzt = (
  text: string,
  { anfang, mindestens }: Fortsetzung,
  werte: readonly string[],
): Bereich[] => {
  let laengstes = mindestens - 1;
  for (const w of werte)
    for (let k = Math.min(w.length, text.length - anfang); k > laengstes; k--)
      if (w.endsWith(text.slice(anfang, anfang + k))) {
        laengstes = k;
        break;
      }
  return laengstes >= mindestens ? [[anfang, anfang + laengstes]] : [];
};

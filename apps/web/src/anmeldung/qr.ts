import { encode } from "uqr";

/** The runs of dark modules in one row, as [start, length] */
const laeufe = (zeile: readonly boolean[]): [number, number][] => {
  const ergebnis: [number, number][] = [];
  zeile.forEach((dunkel, x) => {
    if (!dunkel) return;
    const letzter = ergebnis.at(-1);
    if (letzter && letzter[0] + letzter[1] === x) letzter[1] += 1;
    else ergebnis.push([x, 1]);
  });
  return ergebnis;
};

/**
 * A QR code as one SVG path, each run of dark modules one rectangle (uqr encodes, the page draws;
 * after Speicherstadt/kennwort, apps/web/src/pairing/qr.ts)
 */
export const qrPfad = (text: string) => {
  const qr = encode(text, { ecc: "M", border: 2 });
  const d = qr.data
    .flatMap((zeile, y) => laeufe(zeile).map(([x, n]) => `M${x} ${y}h${n}v1h-${n}z`))
    .join("");
  return { groesse: qr.size, d };
};

/** The secret of an otpauth:// URI, for typing it in by hand */
export const totpGeheimnis = (uri: string): string =>
  URL.parse(uri)?.searchParams.get("secret") ?? "";

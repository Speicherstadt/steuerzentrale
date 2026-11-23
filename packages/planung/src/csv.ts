/*
 * CSV after RFC 4180 (section 2; docs/plan.md, "Leistungen"): records end in CRLF, the first is the
 * header, fields are separated by a comma; a field with a comma, a quote, CR or LF stands in quotes
 * and a quote inside is doubled. A text that a spreadsheet would take for a formula (starting with
 * =, +, -, @, tab or CR; OWASP "CSV Injection") gets an apostrophe in front: a customer's name
 * comes from a person and must not run in the operator's spreadsheet. Numbers are written as
 * they are, with a dot.
 */

export type CsvWert = string | number | null;

const FORMEL = /^[=+\-@\t\r]/;
const ZITIEREN = /[",\r\n]/;

export const csvFeld = (wert: CsvWert): string => {
  if (wert === null) return "";
  if (typeof wert === "number") return String(wert);
  const sicher = FORMEL.test(wert) ? `'${wert}` : wert;
  return ZITIEREN.test(sicher) ? `"${sicher.replaceAll('"', '""')}"` : sicher;
};

const zeile = (werte: readonly CsvWert[]): string => `${werte.map(csvFeld).join(",")}\r\n`;

/** The header and the records; a record with another number of fields is a mistake of the caller */
export const csvText = (
  kopf: readonly string[],
  zeilen: readonly (readonly CsvWert[])[],
): string => {
  for (const z of zeilen)
    if (z.length !== kopf.length)
      throw new Error(`record with ${z.length} fields, header has ${kopf.length}`);
  return [kopf, ...zeilen].map(zeile).join("");
};

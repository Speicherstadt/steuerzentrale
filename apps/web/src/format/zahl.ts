import { getLocale, m } from "@steuerzentrale/ui";

/** Numbers with the decimal mark of the interface language and a unit (DESIGN.md, "Sprache") */

const sprache = () => (getLocale() === "de" ? "de-DE" : "en-GB");

export const zahl = (wert: number, stellen = 0) =>
  new Intl.NumberFormat(sprache(), {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  }).format(wert);

export const gb = (wert: number): string => m.einheit_gb({ wert: zahl(wert, 1) });

/** Bytes in GB of 1024³, as `speicher` counts a GB */
export const gbAusBytes = (bytes: number): string => gb(bytes / 1024 ** 3);

export const prozent = (wert: number, stellen = 0): string =>
  m.einheit_prozent({ wert: zahl(wert, stellen) });

/** Memory of a manifest: MB below a gigabyte, whole or half GB above */
export const speicher = (mb: number): string =>
  mb < 1024 ? m.einheit_mb({ wert: zahl(mb) }) : m.einheit_gb({ wert: zahl(mb / 1024) });

export const minuten = (wert: number): string => m.einheit_minuten({ wert: zahl(wert) });

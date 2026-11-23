/*
 * The events of a support access (BAULISTE.md Z-802), German like every event the Zentrale writes:
 * the customer reads them on the customer page and later in the portal.
 */

export const START_ART = "support_zugang";
export const ENDE_ART = "support_zugang_ende";

/** A duration as "2 h", "45 Min." or "1 h 30 Min." */
export const dauerText = (ms: number): string => {
  const minuten = Math.round(ms / 60_000);
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  if (stunden === 0) return `${rest} Min.`;
  return rest === 0 ? `${stunden} h` : `${stunden} h ${rest} Min.`;
};

export const startText = (name: string, dauerMs: number, grund: string): string =>
  `Support-Zugang gestartet: ${name}, ${dauerText(dauerMs)}, „${grund}“`;

export const vonHandText = (name: string, dauerMs: number): string =>
  `Support-Zugang beendet: ${name} nach ${dauerText(dauerMs)}`;

export const abgelaufenText = (name: string, dauerMs: number): string =>
  `Support-Zugang abgelaufen: ${name} nach ${dauerText(dauerMs)}`;

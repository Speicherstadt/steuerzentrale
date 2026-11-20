/**
 * A simple rate limit (BAULISTE.md Z-302; Z-303 refines it): at most `grenze` attempts per key in a
 * window of `fensterMs`, counted in memory. A restart resets the counts, which is enough for a token
 * of 32 random bytes that cannot be guessed anyway: the limit only keeps a client from hammering.
 */
export type Drossel = (schluessel: string, jetzt: number) => boolean;

export const drossel = (grenze: number, fensterMs: number): Drossel => {
  const zaehler = new Map<string, { beginn: number; anzahl: number }>();
  return (schluessel, jetzt) => {
    // old windows go, so the map cannot grow with every address that ever asked
    for (const [k, eintrag] of zaehler) if (jetzt - eintrag.beginn >= fensterMs) zaehler.delete(k);
    const eintrag = zaehler.get(schluessel) ?? { beginn: jetzt, anzahl: 0 };
    eintrag.anzahl += 1;
    zaehler.set(schluessel, eintrag);
    return eintrag.anzahl <= grenze;
  };
};

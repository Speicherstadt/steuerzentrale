import { isIPv6 } from "node:net";

/**
 * A rate limit (BAULISTE.md Z-302, refined in Z-303): at most `grenze` attempts per key in a window
 * of `fensterMs`, counted in memory. A restart resets the counts, which is enough for a token of 32
 * random bytes that cannot be guessed anyway: the limit only keeps a client from hammering. The map
 * holds at most `hoechstens` keys; while it is full, a key it does not know yet is refused, so a
 * client with a whole range of addresses cannot fill the memory.
 */
export type Drossel = (schluessel: string, jetzt: number) => boolean;

export const drossel = (grenze: number, fensterMs: number, hoechstens = 10_000): Drossel => {
  const zaehler = new Map<string, { beginn: number; anzahl: number }>();
  let aufgeraeumt = Number.NEGATIVE_INFINITY;
  const aufraeumen = (jetzt: number) => {
    for (const [k, eintrag] of zaehler) if (jetzt - eintrag.beginn >= fensterMs) zaehler.delete(k);
    aufgeraeumt = jetzt;
  };
  return (schluessel, jetzt) => {
    // old windows go now and then, and whenever the map is full, not on every attempt
    if (jetzt - aufgeraeumt >= fensterMs || zaehler.size >= hoechstens) aufraeumen(jetzt);
    let eintrag = zaehler.get(schluessel);
    if (eintrag && jetzt - eintrag.beginn >= fensterMs) eintrag = undefined;
    if (!eintrag) {
      if (zaehler.size >= hoechstens) return false;
      eintrag = { beginn: jetzt, anzahl: 0 };
    }
    eintrag.anzahl += 1;
    zaehler.set(schluessel, eintrag);
    return eintrag.anzahl <= grenze;
  };
};

/**
 * The key an address counts under: an IPv4 address itself (also written as IPv4-mapped IPv6), an
 * IPv6 address by its /64, the smallest network a provider hands out; otherwise one client could
 * try with every address of its network
 */
export const drosselSchluessel = (adresse: string): string => {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(adresse);
  if (v4) return v4[1] ?? adresse;
  if (!isIPv6(adresse)) return adresse;
  const [vorne = "", hinten = ""] = adresse.toLowerCase().split("::");
  const links = vorne === "" ? [] : vorne.split(":");
  const rechts = hinten === "" ? [] : hinten.split(":");
  const gruppen = adresse.includes("::")
    ? [...links, ...Array(8 - links.length - rechts.length).fill("0"), ...rechts]
    : links;
  return `${gruppen
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`;
};

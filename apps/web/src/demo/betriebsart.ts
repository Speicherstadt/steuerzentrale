import type { BetriebsartQuelle, BetriebsartStand } from "../daten/betriebsart.ts";

/**
 * The Betriebsart of the demo operator in memory, "Für Kunden" at the start; the switch in the
 * settings shows "Nur für mich" with the internal customer "intern" (demo/kunden.ts). Unlike the
 * Zentrale the demo does not refuse "Nur für mich" for its other customers' installations, so both
 * kinds can be seen. A change lasts until the page reloads.
 */
export const demoBetriebsart = (
  start: BetriebsartStand = { betriebsart: "kunden", eigenerKundeId: null },
): BetriebsartQuelle => {
  let stand = { ...start };
  return {
    lesen: async () => ({ ok: true, status: 200, daten: { ...stand } }),
    setzen: async (betriebsart) => {
      stand = { betriebsart, eigenerKundeId: stand.eigenerKundeId ?? "intern" };
      return { ok: true, status: 200, daten: { ...stand } };
    },
  };
};

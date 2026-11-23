import { describe, expect, it } from "vitest";
import type { AussenStand } from "./aussen.ts";
import { type Bewertungsstand, STOERUNG_NACH_MS } from "./bewertung.ts";
import { rotSeit5Min, stoerungPruefen } from "./stoerung.ts";

/*
 * docs/plan.md, "Störung": health inside or outside red for longer than five minutes is a fault
 * (BAULISTE.md Z-704: "Agent grün, außen rot"); it ends only when both sides are green again.
 */

const T = Date.UTC(2026, 10, 23, 12);
const S = STOERUNG_NACH_MS;
const innen = (bewertung: Bewertungsstand["bewertung"], gemeldetAm = T + S): Bewertungsstand => ({
  bewertung,
  grund: { code: "health", werte: { text: "HTTP 200" } },
  seit: T,
  gemeldetAm,
});
const aussen = (zustand: AussenStand["zustand"], geprueftAm = T + S): AussenStand => ({
  zustand,
  grund: { code: zustand === "rot" ? "health" : "erreichbar", werte: {} },
  seit: T,
  geprueftAm,
});

describe("a fault from outside", () => {
  it("begins after five minutes of red outside while the agent reports green", () => {
    expect(stoerungPruefen(innen("gruen"), false, T + S - 1_000, aussen("rot"))).toBeUndefined();
    expect(stoerungPruefen(innen("gruen"), false, T + S, aussen("rot"))).toBe("stoerung");
    expect(rotSeit5Min(innen("gruen"), aussen("rot"), T + S)).toBe("aussen");
  });

  it("begins also for an installation the agent never reported", () => {
    expect(stoerungPruefen(null, false, T + S, aussen("rot"))).toBe("stoerung");
  });

  it("counts red outside only while checks come", () => {
    expect(
      stoerungPruefen(innen("gruen"), false, T + S, aussen("rot", T + 60_000)),
    ).toBeUndefined();
  });

  it("is not ended by green inside while outside is still red or unknown", () => {
    expect(stoerungPruefen(innen("gruen"), true, T + S, aussen("rot"))).toBeUndefined();
    expect(
      stoerungPruefen(innen("gruen"), true, T + S, aussen("gruen", T + 60_000)),
    ).toBeUndefined();
  });

  it("ends once both sides are green, or the agent never reported", () => {
    expect(stoerungPruefen(innen("gruen"), true, T + S, aussen("gruen"))).toBe("behoben");
    expect(stoerungPruefen(innen("rot"), true, T + S, aussen("gruen"))).toBeUndefined();
    expect(stoerungPruefen(innen("unbekannt"), true, T + S, aussen("gruen"))).toBeUndefined();
    expect(stoerungPruefen(null, true, T + S, aussen("gruen"))).toBe("behoben");
  });

  it("names inside first when both are red", () => {
    expect(rotSeit5Min(innen("rot"), aussen("rot"), T + S)).toBe("innen");
    expect(rotSeit5Min(innen("gruen"), aussen("gruen"), T + S)).toBeUndefined();
  });
});

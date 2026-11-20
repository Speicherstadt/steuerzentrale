import { describe, expect, it } from "vitest";
import { type Sockel, verbindungen } from "./verbindungen.ts";

const sockel = () => {
  const geschlossen: [number, string][] = [];
  const s: Sockel = {
    senden: () => {},
    schliessen: (code, grund) => geschlossen.push([code, grund]),
  };
  return { s, geschlossen };
};

describe("verbindungen", () => {
  it("keeps one connection per server and closes the older when a newer comes", () => {
    const v = verbindungen(4409);
    const alt = sockel();
    const neu = sockel();
    v.anmelden("b1", "s1", alt.s, 10);
    v.anmelden("b1", "s1", neu.s, 20);
    expect(alt.geschlossen).toEqual([[4409, "replaced by a newer connection"]]);
    expect(v.aktuell("b1", "s1", alt.s)).toBe(false);
    expect(v.aktuell("b1", "s1", neu.s)).toBe(true);
    expect(v.verbundenSeit("b1", "s1")).toBe(20);
    // the older one's close comes late and must not remove the newer
    v.abmelden("b1", "s1", alt.s);
    expect(v.verbundenSeit("b1", "s1")).toBe(20);
  });

  it("keeps servers of different operators apart", () => {
    const v = verbindungen(4409);
    const a = sockel();
    v.anmelden("b1", "s1", a.s, 10);
    expect(v.verbundenSeit("b2", "s1")).toBeUndefined();
    expect(v.trennen("b2", "s1", 4403, "x")).toBe(false);
    expect(a.geschlossen).toEqual([]);
  });

  it("closes and forgets a connection on trennen", () => {
    const v = verbindungen(4409);
    const a = sockel();
    v.anmelden("b1", "s1", a.s, 10);
    expect(v.trennen("b1", "s1", 4403, "revoked")).toBe(true);
    expect(a.geschlossen).toEqual([[4403, "revoked"]]);
    expect(v.verbundenSeit("b1", "s1")).toBeUndefined();
  });
});

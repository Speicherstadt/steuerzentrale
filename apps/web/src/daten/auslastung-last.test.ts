import { describe, expect, it } from "vitest";
import { lastReihe } from "./auslastung.ts";

// BAULISTE.md Z-1106: each step the highest reading, the newest hour's value; gaps add nothing
const JETZT = Date.UTC(2026, 10, 20, 12);
const H = 3_600_000;

describe("lastReihe", () => {
  it("keeps the highest reading of each hour in 24 hours and the newest", () => {
    const stunden = [
      { stunde: JETZT - 30 * H, cpu: 99 },
      { stunde: JETZT - 3 * H, cpu: 20 },
      { stunde: JETZT - 2 * H, cpu: null },
      { stunde: JETZT - H, cpu: 40 },
    ];
    const r = lastReihe(stunden, (s) => s.cpu, "24h", JETZT);
    expect(r.punkte.map((p) => p.wert)).toEqual([20, 40]);
    expect(r.aktuell).toBe(40);
  });

  it("puts four hours into a point over 7 days, the highest of them", () => {
    const stunden = [0, 1, 2, 3].map((n) => ({ stunde: JETZT - 7 * 24 * H + n * H, cpu: n * 10 }));
    expect(lastReihe(stunden, (s) => s.cpu, "7t", JETZT).punkte.map((p) => p.wert)).toEqual([30]);
  });

  it("is empty without readings", () => {
    expect(lastReihe([], () => 1, "30t", JETZT)).toEqual({ punkte: [], aktuell: null });
  });
});

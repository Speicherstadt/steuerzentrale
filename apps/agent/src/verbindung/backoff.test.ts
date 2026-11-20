import { describe, expect, it } from "vitest";
import { BACKOFF_ANFANG_MS, BACKOFF_HOECHSTENS_MS, wartezeit } from "./backoff.ts";

describe("wartezeit", () => {
  it("doubles with every attempt, between half and the whole of the bound", () => {
    expect([0, 1, 2, 3].map((v) => wartezeit(v, 0))).toEqual([500, 1000, 2000, 4000]);
    expect([0, 1, 2, 3].map((v) => wartezeit(v, 0.999_999))).toEqual([1000, 2000, 4000, 8000]);
  });

  it("never waits longer than five minutes, however many attempts failed", () => {
    for (const versuch of [9, 10, 50, 1000])
      expect(wartezeit(versuch, 0.999_999)).toBeLessThanOrEqual(BACKOFF_HOECHSTENS_MS);
    expect(wartezeit(1000, 0)).toBe(BACKOFF_HOECHSTENS_MS / 2);
  });

  it("spreads the agents: the random half differs", () => {
    expect(wartezeit(4, 0.1)).not.toBe(wartezeit(4, 0.9));
    expect(wartezeit(0, 0.5)).toBe(0.75 * BACKOFF_ANFANG_MS);
  });
});

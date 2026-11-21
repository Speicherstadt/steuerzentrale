import { describe, expect, it } from "vitest";
import { eimer } from "./eimer.ts";

describe("eimer", () => {
  it("lets the stock pass at once, then one per refill", () => {
    const erlaubt = eimer(2, 60_000);
    expect([erlaubt(0), erlaubt(0), erlaubt(0)]).toEqual([true, true, false]);
    expect(erlaubt(30_000)).toBe(false);
    expect(erlaubt(60_000)).toBe(true);
    expect(erlaubt(60_000)).toBe(false);
  });

  it("refills nothing when the clock jumps back", () => {
    const erlaubt = eimer(1, 1000);
    expect(erlaubt(10_000)).toBe(true);
    expect(erlaubt(0)).toBe(false);
  });
});

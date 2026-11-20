import { describe, expect, it } from "vitest";
import { drossel, drosselSchluessel } from "./drossel.ts";

describe("drossel", () => {
  it("allows `grenze` attempts per key in the window, then refuses until it is over", () => {
    const d = drossel(3, 1000);
    expect([0, 1, 2, 3].map((t) => d("a", t))).toEqual([true, true, true, false]);
    expect(d("b", 4)).toBe(true);
    expect(d("a", 999)).toBe(false);
    expect(d("a", 1000)).toBe(true);
  });

  it("holds at most `hoechstens` keys: a new one is refused while the map is full", () => {
    const d = drossel(5, 1000, 3);
    expect(["a", "b", "c"].map((k) => d(k, 0))).toEqual([true, true, true]);
    expect(d("d", 10)).toBe(false);
    // known keys keep their own count
    expect(d("a", 10)).toBe(true);
    // once the windows are over, the map empties and new keys count again
    expect(d("d", 1000)).toBe(true);
  });
});

describe("drosselSchluessel", () => {
  it("counts an IPv6 address by its /64", () => {
    expect(drosselSchluessel("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(drosselSchluessel("2001:0db8:0001:0002:ffff:eeee:dddd:cccc")).toBe("2001:db8:1:2::/64");
    expect(drosselSchluessel("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(drosselSchluessel("::1")).toBe("0:0:0:0::/64");
  });

  it("keeps an IPv4 address, also IPv4-mapped", () => {
    expect(drosselSchluessel("198.51.100.7")).toBe("198.51.100.7");
    expect(drosselSchluessel("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });

  it("leaves what is no address as it is", () => {
    expect(drosselSchluessel("")).toBe("");
  });
});

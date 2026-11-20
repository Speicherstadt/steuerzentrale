import { describe, expect, it } from "vitest";
import { liesThema, speichereThema, umgeschaltet, wendeThemaAn } from "./theme.ts";

const ablage = () => {
  const werte = new Map<string, string>();
  return {
    getItem: (key: string) => werte.get(key) ?? null,
    setItem: (key: string, value: string) => void werte.set(key, value),
  };
};

describe("theme", () => {
  it("follows the device when nothing or something unknown is stored", () => {
    expect(liesThema(undefined)).toBe("system");
    const a = ablage();
    a.setItem("steuerzentrale-thema", "lila");
    expect(liesThema(a)).toBe("system");
  });

  it("reads back what was stored and survives blocked storage", () => {
    const a = ablage();
    speichereThema(a, "dunkel");
    expect(liesThema(a)).toBe("dunkel");
    const gesperrt = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(liesThema(gesperrt)).toBe("system");
    expect(() => speichereThema(gesperrt, "hell")).not.toThrow();
  });

  it("switches to the opposite of what is shown, the device's choice included", () => {
    expect(umgeschaltet("system", true)).toBe("hell");
    expect(umgeschaltet("system", false)).toBe("dunkel");
    expect(umgeschaltet("dunkel", false)).toBe("hell");
    expect(umgeschaltet("hell", true)).toBe("dunkel");
  });

  it("sets data-theme on the root, and removes it to follow the device", () => {
    const root = document.createElement("html");
    wendeThemaAn(root, "dunkel");
    expect(root.dataset.theme).toBe("dark");
    wendeThemaAn(root, "system");
    expect(root.dataset.theme).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { ariaBoolean } from "./aria.ts";
import { cn } from "./cn.ts";
import { nextIndex } from "./keys.ts";
import { variants } from "./variants.ts";

describe("cn", () => {
  it("joins the parts that are set", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
    expect(cn()).toBe("");
  });
});

describe("variants", () => {
  const button = variants(
    "btn",
    { variant: { primary: "bg-primary", outline: "border" }, size: { sm: "h-7", md: "h-9" } },
    { variant: "primary", size: "md" },
  );

  it("takes the base, the chosen options and the defaults for the rest", () => {
    expect(button()).toBe("btn bg-primary h-9");
    expect(button({ variant: "outline" })).toBe("btn border h-9");
    expect(button({ variant: "outline", size: "sm" })).toBe("btn border h-7");
  });
});

describe("nextIndex", () => {
  it("steps down and up and wraps around", () => {
    expect(nextIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextIndex("ArrowUp", 2, 3)).toBe(1);
  });

  it("jumps with Home and End", () => {
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
  });

  it("starts at the top going down and at the bottom going up when nothing is chosen", () => {
    expect(nextIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextIndex("ArrowUp", -1, 3)).toBe(2);
  });

  it("uses left and right for horizontal lists, and ignores keys of the other direction", () => {
    expect(nextIndex("ArrowRight", 0, 3, "horizontal")).toBe(1);
    expect(nextIndex("ArrowLeft", 0, 3, "horizontal")).toBe(2);
    expect(nextIndex("ArrowDown", 0, 3, "horizontal")).toBeUndefined();
    expect(nextIndex("ArrowRight", 0, 3)).toBeUndefined();
  });

  it("ignores other keys and empty lists", () => {
    expect(nextIndex("a", 0, 3)).toBeUndefined();
    expect(nextIndex("ArrowDown", 0, 0)).toBeUndefined();
    expect(nextIndex("Home", 0, 0)).toBeUndefined();
  });
});

describe("ariaBoolean", () => {
  it("writes the state as the attribute value", () => {
    expect(ariaBoolean(true)).toBe("true");
    expect(ariaBoolean(false)).toBe("false");
  });
});

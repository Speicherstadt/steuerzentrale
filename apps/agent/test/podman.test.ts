import { describe, expect, it } from "vitest";
import { atLeast } from "./podman.ts";

describe("atLeast", () => {
  it("compares major, minor and patch", () => {
    expect(atLeast("4.9.3", "4.9")).toBe(true);
    expect(atLeast("5.4.2", "4.9")).toBe(true);
    expect(atLeast("4.4.1", "4.9")).toBe(false);
    expect(atLeast("4.10.0", "4.9")).toBe(true);
  });

  it("reads a version with a suffix", () => {
    expect(atLeast("5.0.0-dev", "4.9")).toBe(true);
  });
});

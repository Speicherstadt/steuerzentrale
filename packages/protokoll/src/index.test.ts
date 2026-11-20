import { describe, expect, it } from "vitest";
import { PROTOKOLL_VERSION } from "./index.ts";

describe("protokoll", () => {
  it("starts at version 1", () => {
    expect(PROTOKOLL_VERSION).toBe(1);
  });
});

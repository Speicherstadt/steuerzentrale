import { describe, expect, it } from "vitest";
import { MANIFEST_SCHEMA } from "./index.ts";

describe("manifest", () => {
  it("reads schema version 1, the one docs/plan.md describes", () => {
    expect(MANIFEST_SCHEMA).toBe(1);
  });
});

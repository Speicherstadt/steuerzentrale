import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";

// Zentrale and agent report the version of packages/protokoll; it must be the one of the release
describe("version", () => {
  it("equals the version in the root package.json", () => {
    const root = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(VERSION).toBe(root.version);
  });
});

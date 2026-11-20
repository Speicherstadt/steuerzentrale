import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonSchema, ZIEL } from "./manifest-schema.ts";

describe("manifest JSON Schema", () => {
  it("matches the Zod schema (run `bun scripts/manifest-schema.ts`)", () => {
    // Compared as data: Biome formats the file
    expect(JSON.parse(readFileSync(join(import.meta.dirname, "..", ZIEL), "utf8"))).toEqual(
      JSON.parse(jsonSchema()),
    );
  });

  it("names the required top-level fields", () => {
    const schema = JSON.parse(jsonSchema());
    expect(schema.required).toEqual(
      expect.arrayContaining(["schema", "id", "version", "container", "health", "aktionen"]),
    );
  });
});

/**
 * Writes the manifest's JSON Schema (packages/manifest/manifest.schema.json) from the Zod schema, for
 * editors and app developers (docs/manifest.md). `bun scripts/manifest-schema.ts` after a schema
 * change; scripts/manifest-schema.test.ts fails in CI when the file is out of date. The rules across
 * fields (pruefungen.ts) are not expressible in JSON Schema; the Zentrale checks them on import.
 */
import { writeFileSync } from "node:fs";
import { manifestJsonSchema } from "@steuerzentrale/manifest";

export const ZIEL = "packages/manifest/manifest.schema.json";

export const jsonSchema = (): string => `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`;

if (import.meta.main) {
  writeFileSync(ZIEL, jsonSchema());
  Bun.spawnSync(["bunx", "biome", "format", "--write", ZIEL]);
}

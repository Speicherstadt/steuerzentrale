import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationenQuelle, ORDNER, ZIEL } from "./migrationen.ts";

const root = join(import.meta.dirname, "..");

describe("embedded migrations", () => {
  it("match apps/zentrale/drizzle (run `bun run db:generate`)", () => {
    expect(readFileSync(join(root, ZIEL), "utf8")).toBe(migrationenQuelle(join(root, ORDNER)));
  });
});

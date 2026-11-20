import { getTableColumns, getTableName } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.ts";

/**
 * Every table with data of an operator carries `betreiber_id` (docs/plan.md, "Mandanten"). Exempt:
 * manifests and Better Auth's tables, which later items add here by name.
 */
const AUSGENOMMEN = new Set<string>([]);

const tabellen = Object.values(schema).filter((wert): wert is SQLiteTable => wert instanceof SQLiteTable);

describe("tenancy", () => {
  it("finds the tables of the schema", () => {
    expect(tabellen.length).toBeGreaterThan(3);
  });

  it("gives every table a non-null betreiber_id", () => {
    for (const tabelle of tabellen) {
      if (AUSGENOMMEN.has(getTableName(tabelle))) continue;
      const spalte = Object.values(getTableColumns(tabelle)).find((s) => s.name === "betreiber_id");
      expect(spalte, getTableName(tabelle)).toBeDefined();
      expect(spalte?.notNull, getTableName(tabelle)).toBe(true);
    }
  });
});

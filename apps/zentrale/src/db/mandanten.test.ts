import { getTableColumns, getTableName } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as authSchema from "./auth-schema.ts";
import * as schema from "./schema.ts";

/**
 * Every table with data of an operator carries `betreiber_id` (docs/plan.md, "Mandanten"). Exempt:
 * the imported manifests, which hold for every operator (Z-501), and Better Auth's tables, whose membership is the organization's; their
 * memberships and roles are mirrored into `mitglieder`, which carries it (Z-104).
 */
const AUSGENOMMEN = new Set<string>([
  "manifeste",
  "user",
  "session",
  "account",
  "verification",
  "organization",
  "member",
  "invitation",
  "two_factor",
  "passkey",
]);

const tabellen = Object.values({ ...schema, ...authSchema } as Record<string, unknown>).filter(
  (wert): wert is SQLiteTable => wert instanceof SQLiteTable,
);

describe("tenancy", () => {
  it("finds the tables of the schema", () => {
    expect(tabellen.length).toBeGreaterThan(3);
  });

  it("exempts only tables that exist", () => {
    const namen = new Set(tabellen.map((tabelle) => getTableName(tabelle)));
    for (const name of AUSGENOMMEN) expect(namen.has(name), name).toBe(true);
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

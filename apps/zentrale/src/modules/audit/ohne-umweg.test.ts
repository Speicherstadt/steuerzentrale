import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as authSchema from "../../db/auth-schema.ts";
import * as schema from "../../db/schema.ts";

/**
 * No code writes past the audit log (Z-102). The only files that may write: the audit writer, the
 * appending of measurements (heartbeats), the migrations and the key's check value on their own bookkeeping tables and the opening of the database. Every other source of
 * apps/zentrale is scanned for the ways to write. Modelled on Speicherstadt/soll,
 * apps/server/src/modules/audit/ohne-umweg.test.ts.
 */
const SRC = join(import.meta.dirname, "../..");
const ERLAUBT = new Set([
  "modules/audit/schreiben.ts",
  "db/migrieren.ts",
  "db/oeffnen.ts",
  // the key's check value and Better Auth's secret, bookkeeping like the migrations' (Z-103, Z-104)
  "db/schluessel.ts",
  // Better Auth writes its own tables (accounts, sessions, organizations, members, passkeys, TOTP)
  // on the writable connection, outside the audit log by design (docs/plan.md, "Mandanten"); what
  // the Zentrale keeps of them (operator, membership, role) goes through `schreiben` (Z-104), as in
  // Speicherstadt/soll, apps/server/src/modules/audit/ohne-umweg.test.ts
  "auth/auth.ts",
  // heartbeats are measurements, not actions: appended without an audit entry each, deleted only
  // through `schreiben` by the retention (docs/plan.md, "Audit-Log"; Z-303)
  "modules/audit/messwerte.ts",
]);
const TABELLEN = [...Object.keys(schema), ...Object.keys(authSchema)].join("|");

const SCHREIBEN = [
  new RegExp(`\\.(insert|update|delete)\\s*\\(\\s*(\\w+\\.)?(${TABELLEN})\\b`),
  /\.(insert|update|delete)\s*\(\s*tabellen\b/,
  /\$client\b/,
  /\bsql\.raw\s*\(/,
  /\bsql\s*`/,
  /\b(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|DROP\s+(TABLE|TRIGGER)|ALTER\s+TABLE)\b/i,
  /from\s+["']bun:sqlite["']/,
  /(?<![\w/-])(sqlite|verbindung)(?![\w-])/,
  /\bPRAGMA\b/i,
  /\bCREATE\s+(\w+\s+)*(TABLE|VIEW|TRIGGER|INDEX)\b/i,
  /\bATTACH\s+(DATABASE\s+)?["'`$]/i,
];

/** Drizzle's write builders on any table expression, across lines */
const BAUSTEIN =
  /\.\s*(insert\s*\([^;]*?\)\s*\.\s*(values|select)|update\s*\([^;]*?\)\s*\.\s*set|delete\s*\([^;]*?\)\s*\.\s*(where|run|returning|all|get|execute))\s*\(/g;

const quellen = (ordner: string): string[] =>
  readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) return quellen(pfad);
    return /\.tsx?$/.test(eintrag.name) &&
      !/\.test\.tsx?$/.test(eintrag.name) &&
      !eintrag.name.endsWith(".gen.ts")
      ? [pfad]
      : [];
  });

export const umwegeIn = (datei: string, text: string): string[] => {
  const bausteine = new Set(
    [...text.matchAll(BAUSTEIN)].map(
      (treffer) => text.slice(0, treffer.index).split("\n").length - 1,
    ),
  );
  return text
    .split("\n")
    .flatMap((zeile, index) =>
      bausteine.has(index) || SCHREIBEN.some((muster) => muster.test(zeile))
        ? [`${datei}:${index + 1}: ${zeile.trim()}`]
        : [],
    );
};

describe("writes past the audit log", () => {
  it("exist nowhere outside the audit writer and the migrations", () => {
    const umwege = quellen(SRC)
      .map((pfad) => relative(SRC, pfad))
      .filter((datei) => !ERLAUBT.has(datei) && !datei.endsWith("test-db.ts"))
      .flatMap((datei) => umwegeIn(datei, readFileSync(join(SRC, datei), "utf8")));
    expect(umwege).toEqual([]);
  });

  it("are found in every shape the scan knows", () => {
    const beispiele = [
      "db.insert(betreiber).values({})",
      "tx\n  .update(t)\n  .set({ a: 1 })",
      "db.delete(x).where(eq(a, b))",
      "db.$client.run('x')",
      "db.run(sql`DELETE FROM betreiber`)",
      'import { Database } from "bun:sqlite";',
      "offen.sqlite.run('x')",
      "schreibDb.verbindung.insert(a)",
      "db.run(sql.raw('PRAGMA query_only = OFF'))",
    ];
    for (const beispiel of beispiele) expect(umwegeIn("x.ts", beispiel), beispiel).not.toEqual([]);
  });

  it("leave reads alone", () => {
    expect(umwegeIn("x.ts", "db.select().from(betreiber).where(eq(a, b)).all()")).toEqual([]);
  });
});

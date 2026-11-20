import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";
import * as schema from "./schema.ts";

const oeffneSqlite = (pfad: string): Database => {
  const sqlite = new Database(pfad, { create: true, strict: true });
  // WAL: readers do not wait for the writer (docs/plan.md, "Technologie")
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA busy_timeout = 5000");
  return sqlite;
};

const alsDrizzle = (sqlite: Database) => drizzle(sqlite, { schema });

export type Db = ReturnType<typeof alsDrizzle>;

declare const schreibMarke: unique symbol;

/**
 * The one writable connection, handed only to `schreiben` (src/modules/audit): everything else reads through `db`, which SQLite opens read-only, so a
 * write past the audit log fails at run time, not only in the static test (Z-102).
 */
export type SchreibDb = { readonly verbindung: Db; readonly [schreibMarke]: true };

export type Datenbank = {
  /** Read-only: every query of the modules goes here */
  db: Db;
  /** For `schreiben` alone */
  schreibDb: SchreibDb;
  /** The writable connection itself, for tests that tamper on purpose */
  sqlite: Database;
  schliessen: () => void;
};

/** Opens the database at `pfad`, applies the embedded migrations, returns both connections */
export const oeffneDatenbank = (pfad: string, jetzt: number): Datenbank => {
  const sqlite = oeffneSqlite(pfad);
  migrieren(sqlite, migrationen, jetzt);
  const lesend = new Database(pfad, { readonly: true, strict: true });
  lesend.run("PRAGMA busy_timeout = 5000");
  // A read-only connection still writes TEMP tables; query_only refuses those too
  // (sqlite.org/pragma.html#pragma_query_only)
  lesend.run("PRAGMA query_only = ON");
  return {
    db: alsDrizzle(lesend),
    schreibDb: { verbindung: alsDrizzle(sqlite) } as SchreibDb,
    sqlite,
    schliessen: () => {
      lesend.close();
      sqlite.close();
    },
  };
};

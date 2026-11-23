import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";
import * as schema from "./schema.ts";
import {
  anmeldeGeheimnis,
  anmeldeGeheimnisErneuern,
  pruefwertErneuern,
  type Schluesselbund,
  schluesselPruefen,
} from "./schluessel.ts";

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
  /** The keys this database was opened with (src/modules/geheim) */
  schluessel: Schluesselbund;
  /** Better Auth's secret, kept encrypted in the database (src/db/schluessel.ts) */
  anmeldeGeheimnis: string;
  /** After a rotation: the check value from now on with the current key */
  rotationAbschliessen: () => void;
  /**
   * A consistent copy of the whole database into the empty file `ziel` (Z-1002), committed rows
   * still in the write-ahead log included; readers and the writer go on meanwhile
   * (sqlite.org/lang_vacuum.html#vacuuminto)
   */
  sicherungSchreiben: (ziel: string) => void;
  /** The writable connection itself, for tests that tamper on purpose */
  sqlite: Database;
  schliessen: () => void;
};

/**
 * Opens the database at `pfad`, applies the embedded migrations, refuses a key that does not open
 * it and returns both connections
 */
export const oeffneDatenbank = (
  pfad: string,
  jetzt: number,
  schluessel: Schluesselbund,
): Datenbank => {
  const sqlite = oeffneSqlite(pfad);
  let geheimnis: string;
  try {
    migrieren(sqlite, migrationen, jetzt);
    schluesselPruefen(sqlite, schluessel);
    geheimnis = anmeldeGeheimnis(sqlite, schluessel);
  } catch (fehler) {
    sqlite.close();
    throw fehler;
  }
  const lesend = new Database(pfad, { readonly: true, strict: true });
  lesend.run("PRAGMA busy_timeout = 5000");
  // A read-only connection still writes TEMP tables; query_only refuses those too
  // (sqlite.org/pragma.html#pragma_query_only)
  lesend.run("PRAGMA query_only = ON");
  return {
    db: alsDrizzle(lesend),
    schreibDb: { verbindung: alsDrizzle(sqlite) } as SchreibDb,
    schluessel,
    anmeldeGeheimnis: geheimnis,
    rotationAbschliessen: () => {
      pruefwertErneuern(sqlite, schluessel.aktuell);
      anmeldeGeheimnisErneuern(sqlite, schluessel);
      // The write-ahead log still holds the pages with the old ciphertexts; emptying it leaves
      // nothing on the old key behind (sqlite.org/pragma.html#pragma_wal_checkpoint)
      sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
    },
    sicherungSchreiben: (ziel) => {
      sqlite.run("VACUUM INTO ?", [ziel]);
    },
    sqlite,
    schliessen: () => {
      lesend.close();
      sqlite.close();
    },
  };
};

/**
 * Whether the file at `pfad` is an undamaged SQLite database (Z-1002, before a backup is restored):
 * opened read-only, so a damaged or foreign file is not touched (sqlite.org/pragma.html#pragma_integrity_check)
 */
export const unversehrt = (pfad: string): boolean => {
  try {
    const datei = new Database(pfad, { readonly: true, strict: true });
    try {
      const zeilen = datei.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all();
      return zeilen.length === 1 && zeilen[0]?.integrity_check === "ok";
    } finally {
      datei.close();
    }
  } catch {
    return false;
  }
};

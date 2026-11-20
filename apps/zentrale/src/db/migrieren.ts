import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export type Migration = { tag: string; sql: string };

/** drizzle-kit separates the statements of a migration with this line */
const GRENZE = "--> statement-breakpoint";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * Applies the embedded migrations not yet in the database, each in its own transaction. A migration
 * applied with other content, or one the binary no longer holds (an older binary on a newer
 * database), stops the start: migrations never change. The bookkeeping table is outside the audit
 * log. From Speicherstadt/soll, apps/server/src/db/migrieren.ts.
 */
export const migrieren = (
  sqlite: Database,
  migrationen: readonly Migration[],
  jetzt: number,
): string[] => {
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS zentrale_migrationen (tag TEXT PRIMARY KEY, hash TEXT NOT NULL, angewendet_am INTEGER NOT NULL)",
  );
  const angewendet = new Map(
    sqlite
      .query<{ tag: string; hash: string }, []>("SELECT tag, hash FROM zentrale_migrationen")
      .all()
      .map((zeile) => [zeile.tag, zeile.hash]),
  );
  const bekannt = new Set(migrationen.map((migration) => migration.tag));
  const unbekannt = [...angewendet.keys()].filter((tag) => !bekannt.has(tag));
  if (unbekannt.length > 0)
    throw new Error(
      `migration ${unbekannt.join(", ")} was applied but is missing from this binary`,
    );
  const neu = migrationen.filter((migration) => {
    const hash = angewendet.get(migration.tag);
    if (hash !== undefined && hash !== sha256(migration.sql))
      throw new Error(`migration ${migration.tag} was changed after it was applied`);
    return hash === undefined;
  });
  for (const migration of neu) anwenden(sqlite, migration, jetzt);
  return neu.map((migration) => migration.tag);
};

const anwenden = (sqlite: Database, migration: Migration, jetzt: number): void => {
  sqlite.transaction(() => {
    for (const statement of migration.sql.split(GRENZE))
      if (statement.trim() !== "") sqlite.run(statement);
    sqlite
      .query("INSERT INTO zentrale_migrationen (tag, hash, angewendet_am) VALUES (?, ?, ?)")
      .run(migration.tag, sha256(migration.sql), jetzt);
  })();
};

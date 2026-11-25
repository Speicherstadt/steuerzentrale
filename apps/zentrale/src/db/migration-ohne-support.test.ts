import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";

/*
 * Z-1203: the support accesses (Z-802) are gone. The migration drops their table, also one with
 * rows in it, and leaves the events they wrote as part of the installations' history.
 */
const TAG = "0025_ohne_support_zugaenge";

const vorher = migrationen.slice(
  0,
  migrationen.findIndex((m) => m.tag === TAG),
);

const tabellen = (sqlite: Database) =>
  sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((t) => t.name);

describe("the migration without support accesses", () => {
  it("drops their table and keeps their events", () => {
    expect(migrationen.some((m) => m.tag === TAG)).toBe(true);
    const sqlite = new Database(":memory:");
    migrieren(sqlite, vorher, 1);
    expect(tabellen(sqlite)).toContain("support_zugaenge");
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite.run(
      "INSERT INTO support_zugaenge (betreiber_id, zugang_id, installation_id, nutzer_id, grund, beginn, ende) VALUES ('b1', 'z1', 'i1', 'n1', 'Ticket 7', 1, 2)",
    );
    const spalten = sqlite
      .query<{ name: string }, []>("PRAGMA table_info(ereignisse)")
      .all()
      .map((s) => s.name);
    const werte: Record<string, string | number> = {
      betreiber_id: "b1",
      ereignis_id: "e1",
      art: "support_zugang",
      zeitpunkt: 1,
    };
    const pflicht = sqlite
      .query<{ name: string; notnull: number; dflt_value: unknown }, []>(
        "PRAGMA table_info(ereignisse)",
      )
      .all()
      .filter((s) => s.notnull === 1 && s.dflt_value === null && !(s.name in werte));
    for (const s of pflicht) werte[s.name] = "x";
    const namen = Object.keys(werte).filter((n) => spalten.includes(n));
    sqlite
      .query(
        `INSERT INTO ereignisse (${namen.join(", ")}) VALUES (${namen.map(() => "?").join(", ")})`,
      )
      .run(...namen.map((n) => werte[n] ?? null));
    migrieren(sqlite, migrationen, 2);
    expect(tabellen(sqlite)).not.toContain("support_zugaenge");
    expect(
      sqlite.query<{ art: string }, []>("SELECT art FROM ereignisse").all().map((e) => e.art),
    ).toEqual(["support_zugang"]);
  });
});

import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";
import { oeffneDatenbank } from "./oeffnen.ts";
import { testDatenbank } from "./test-db.ts";

const zwei = [
  { tag: "0000_a", sql: "CREATE TABLE a (x INTEGER);" },
  { tag: "0001_b", sql: "CREATE TABLE b (y INTEGER);--> statement-breakpoint\nCREATE TABLE c (z INTEGER);" },
];

describe("migrieren", () => {
  it("applies every migration once, statement by statement", () => {
    const sqlite = new Database(":memory:");
    expect(migrieren(sqlite, zwei, 1)).toEqual(["0000_a", "0001_b"]);
    expect(migrieren(sqlite, zwei, 2)).toEqual([]);
    const tabellen = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tabellen.map((t) => t.name)).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("refuses a migration that changed after it was applied", () => {
    const sqlite = new Database(":memory:");
    migrieren(sqlite, zwei, 1);
    const geaendert = [zwei[0], { tag: "0001_b", sql: "CREATE TABLE b (y TEXT);" }] as typeof zwei;
    expect(() => migrieren(sqlite, geaendert, 2)).toThrow("0001_b was changed after it was applied");
  });

  it("refuses a database with a migration this binary does not hold", () => {
    const sqlite = new Database(":memory:");
    migrieren(sqlite, zwei, 1);
    expect(() => migrieren(sqlite, zwei.slice(0, 1), 2)).toThrow("0001_b was applied but is missing");
  });

  it("takes back a migration that fails halfway", () => {
    const sqlite = new Database(":memory:");
    const kaputt = [{ tag: "0000_x", sql: "CREATE TABLE x (a INTEGER);--> statement-breakpoint\nKAPUTT;" }];
    expect(() => migrieren(sqlite, kaputt, 1)).toThrow();
    expect(sqlite.query("SELECT name FROM sqlite_master WHERE name = 'x'").all()).toEqual([]);
    expect(sqlite.query("SELECT tag FROM zentrale_migrationen").all()).toEqual([]);
  });
});

describe("oeffneDatenbank", () => {
  it("stops the start when an applied, embedded migration was changed", () => {
    const { sqlite, pfad } = testDatenbank();
    sqlite.run("UPDATE zentrale_migrationen SET hash = 'anders' WHERE tag = ?", [migrationen[0]?.tag ?? ""]);
    expect(() => oeffneDatenbank(pfad, 1)).toThrow("was changed after it was applied");
  });

  it("opens in WAL mode", () => {
    const { sqlite } = testDatenbank();
    expect(sqlite.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
  });

  it("hands the modules a connection that cannot write", () => {
    const { db } = testDatenbank();
    expect(() => db.$client.run("INSERT INTO betreiber VALUES ('b', 'B', 0)")).toThrow();
    expect(() => db.$client.run("CREATE TEMP TABLE betreiber (x)")).toThrow();
  });
});

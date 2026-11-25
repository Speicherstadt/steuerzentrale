import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";

/*
 * Z-1206: no Betriebsart any more. The migration drops it and the operator's fixed internal
 * customer from `betreiber`; the customer itself stays, marked internal, with its installations.
 */
const TAG = "0030_ohne_betriebsart";

const vorher = migrationen.slice(
  0,
  migrationen.findIndex((m) => m.tag === TAG),
);

describe("the migration without the Betriebsart", () => {
  it("drops it and keeps the internal customer", () => {
    expect(migrationen.some((m) => m.tag === TAG)).toBe(true);
    const sqlite = new Database(":memory:");
    migrieren(sqlite, vorher, 1);
    const spalten = (tabelle: string) =>
      sqlite
        .query<{ name: string }, []>(`PRAGMA table_info(${tabelle})`)
        .all()
        .map((s) => s.name);
    sqlite.run(
      "INSERT INTO betreiber (betreiber_id, name, angelegt_am, betriebsart, eigener_kunde_id) VALUES ('b1', 'Eigen', 0, 'selbst', 'k1')",
    );
    sqlite.run(
      "INSERT INTO kunden (betreiber_id, kunde_id, name, kuerzel, kontakt_name, kontakt_email, intern, angelegt_am) VALUES ('b1', 'k1', 'Eigen', 'eigen', 'E', 'e@e.test', 1, 0)",
    );
    migrieren(sqlite, migrationen, 2);
    expect(spalten("betreiber")).not.toContain("betriebsart");
    expect(spalten("betreiber")).not.toContain("eigener_kunde_id");
    expect(sqlite.query("SELECT betreiber_id, name FROM betreiber").all()).toEqual([
      { betreiber_id: "b1", name: "Eigen" },
    ]);
    expect(sqlite.query("SELECT kunde_id, intern FROM kunden").all()).toEqual([
      { kunde_id: "k1", intern: 1 },
    ]);
  });
});

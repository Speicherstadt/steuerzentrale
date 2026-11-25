import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";

/*
 * Z-1202: a contract has a beginning and an end, no SLA. The migration drops the column and keeps
 * every contract already there, with its customer, beginning and end.
 */
const TAG = "0024_ohne_sla";

const vorher = migrationen.slice(
  0,
  migrationen.findIndex((m) => m.tag === TAG),
);

describe("the migration without SLA", () => {
  it("keeps every contract and drops its SLA", () => {
    expect(migrationen.some((m) => m.tag === TAG)).toBe(true);
    const sqlite = new Database(":memory:");
    migrieren(sqlite, vorher, 1);
    const vertraege = [
      ["b1", "v1", "k1", "basis", 100, null],
      ["b1", "v2", "k2", "plus", 200, 900],
      ["b2", "v3", "k1", "ruhe", 300, null],
    ] as const;
    for (const [b, v, k, sla, beginn, ende] of vertraege) {
      sqlite
        .query(
          "INSERT INTO kunden (betreiber_id, kunde_id, name, kuerzel, kontakt_name, kontakt_email, angelegt_am) VALUES (?, ?, ?, ?, 'K', 'k@k.test', 0)",
        )
        .run(b, k, `Kunde ${k}`, `kunde-${k}`);
      sqlite
        .query(
          "INSERT INTO vertraege (betreiber_id, vertrag_id, kunde_id, sla, beginn, ende, angelegt_am) VALUES (?, ?, ?, ?, ?, ?, 7)",
        )
        .run(b, v, k, sla, beginn, ende);
    }
    migrieren(sqlite, migrationen, 2);
    const spalten = sqlite
      .query<{ name: string }, []>("PRAGMA table_info(vertraege)")
      .all()
      .map((s) => s.name);
    expect(spalten).not.toContain("sla");
    expect(
      sqlite
        .query<Record<string, unknown>, []>(
          "SELECT betreiber_id, vertrag_id, kunde_id, beginn, ende, angelegt_am FROM vertraege ORDER BY vertrag_id",
        )
        .all(),
    ).toEqual(
      vertraege.map(([b, v, k, , beginn, ende]) => ({
        betreiber_id: b,
        vertrag_id: v,
        kunde_id: k,
        beginn,
        ende,
        angelegt_am: 7,
      })),
    );
  });
});

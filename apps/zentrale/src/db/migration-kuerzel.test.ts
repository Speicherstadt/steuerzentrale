import { Database } from "bun:sqlite";
import { kuerzelVorschlag } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";

/*
 * Z-407: the migration gives every customer already there a short name from its name, as
 * kuerzelVorschlag would, unique within its operator (docs/plan.md, "Adresse einer Installation").
 */
const TAG = "0013_adressen";

const vorher = migrationen.slice(
  0,
  migrationen.findIndex((m) => m.tag === TAG),
);

const kunde = (sqlite: Database, betreiberId: string, kundeId: string, name: string) =>
  sqlite
    .query(
      "INSERT INTO kunden (betreiber_id, kunde_id, name, kontakt_name, kontakt_email, angelegt_am) VALUES (?, ?, ?, 'K', 'k@k.test', 0)",
    )
    .run(betreiberId, kundeId, name);

describe("the migration of short names", () => {
  it("suggests one from each name, unique within its operator", () => {
    const sqlite = new Database(":memory:");
    migrieren(sqlite, vorher, 1);
    const namen = [
      ["b1", "11111111-a", "Praxis Dr. Müller & Söhne GmbH"],
      ["b1", "22222222-b", "Praxis Dr. Müller & Söhne GmbH"],
      ["b1", "33333333-c", "Ärzte–Zentrum   Straße"],
      ["b1", "44444444-d", "!!!"],
      ["b1", "55555555-e", "Ein sehr sehr langer Kundenname der über dreißig Zeichen geht"],
      ["b2", "66666666-f", "Praxis Dr. Müller & Söhne GmbH"],
    ] as const;
    for (const [b, k, n] of namen) kunde(sqlite, b, k, n);
    migrieren(sqlite, migrationen, 2);
    const kuerzel = Object.fromEntries(
      sqlite
        .query<{ kunde_id: string; kuerzel: string }, []>("SELECT kunde_id, kuerzel FROM kunden")
        .all()
        .map((z) => [z.kunde_id, z.kuerzel]),
    );
    expect(kuerzel).toEqual({
      "11111111-a": kuerzelVorschlag(namen[0][2]),
      "22222222-b": "praxis-dr-mueller-soe-22222222",
      "33333333-c": kuerzelVorschlag(namen[2][2]),
      "44444444-d": "kunde",
      "55555555-e": kuerzelVorschlag(namen[4][2]),
      "66666666-f": kuerzelVorschlag(namen[5][2]),
    });
    expect(() => kunde(sqlite, "b1", "77777777-g", "x")).not.toThrow();
    expect(() =>
      sqlite.run("UPDATE kunden SET kuerzel = 'kunde' WHERE kunde_id = '77777777-g'"),
    ).toThrow(/UNIQUE/);
  });
});

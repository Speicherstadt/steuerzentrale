import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";

/*
 * Z-1205: every server is the operator's own server for several customers. The migration drops
 * the kind and the customer of a server and keeps every server with its name and certificate.
 */
const TAG = "0029_ohne_serverart";

const vorher = migrationen.slice(
  0,
  migrationen.findIndex((m) => m.tag === TAG),
);

describe("the migration without the kind of a server", () => {
  it("keeps every server and drops kind and customer", () => {
    expect(migrationen.some((m) => m.tag === TAG)).toBe(true);
    const sqlite = new Database(":memory:");
    migrieren(sqlite, vorher, 1);
    const server = [
      ["s1", "gemeinsam", null, "fp1"],
      ["s2", "eigen", "k1", "fp2"],
      ["s3", "beim_kunden", "k2", null],
    ] as const;
    for (const [id, art, kunde, fp] of server)
      sqlite
        .query(
          "INSERT INTO server (betreiber_id, server_id, name, art, kunde_id, wartungsfenster, fingerabdruck, angelegt_von, angelegt_am) VALUES ('b1', ?, ?, ?, ?, '{}', ?, 'n1', 5)",
        )
        .run(id, `Server ${id}`, art, kunde, fp);
    migrieren(sqlite, migrationen, 2);
    const spalten = sqlite
      .query<{ name: string }, []>("PRAGMA table_info(server)")
      .all()
      .map((s) => s.name);
    expect(spalten).not.toContain("art");
    expect(spalten).not.toContain("kunde_id");
    expect(
      sqlite
        .query<Record<string, unknown>, []>(
          "SELECT server_id, name, fingerabdruck, angelegt_am FROM server ORDER BY server_id",
        )
        .all(),
    ).toEqual(
      server.map(([id, , , fp]) => ({
        server_id: id,
        name: `Server ${id}`,
        fingerabdruck: fp,
        angelegt_am: 5,
      })),
    );
  });
});

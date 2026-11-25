import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { migrationen } from "./migrationen.gen.ts";
import { migrieren } from "./migrieren.ts";

/*
 * Z-1204: two roles. The migration makes every member of the role technik an owner and every one of
 * the role support a member, in the Zentrale's mirror (`mitglieder`) and in Better Auth's `member`;
 * an owner stays an owner. An invitation not yet accepted gets the least rights: technik and support
 * both become member, so a link sent before the update grants no owner's rights.
 */
const TAG = "0026_zwei_rollen";

const vorher = migrationen.slice(
  0,
  migrationen.findIndex((m) => m.tag === TAG),
);

const ROLLEN = [
  ["n1", "inhaber", "inhaber"],
  ["n2", "technik", "inhaber"],
  ["n3", "support", "mitglied"],
] as const;

describe("the migration to two roles", () => {
  it("turns technik into owners and support into members, open invitations of both into members", () => {
    expect(migrationen.some((m) => m.tag === TAG)).toBe(true);
    const sqlite = new Database(":memory:");
    migrieren(sqlite, vorher, 1);
    sqlite.run("PRAGMA foreign_keys = OFF");
    for (const [nutzer, rolle] of ROLLEN) {
      sqlite
        .query(
          "INSERT INTO mitglieder (betreiber_id, nutzer_id, rolle, angelegt_am) VALUES ('b1', ?, ?, 0)",
        )
        .run(nutzer, rolle);
      sqlite
        .query(
          "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, 'b1', ?, ?, 0)",
        )
        .run(`m-${nutzer}`, nutzer, rolle);
      sqlite
        .query(
          "INSERT INTO einladungen (betreiber_id, einladung_id, rolle, gueltig_bis, angelegt_von, angelegt_am) VALUES ('b1', ?, ?, 9, 'n1', 0)",
        )
        .run(`e-${nutzer}`, rolle);
      sqlite
        .query(
          "INSERT INTO invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) VALUES (?, 'b1', ?, ?, 'pending', 9, 0, 'n1')",
        )
        .run(`i-${nutzer}`, `${nutzer}@x.test`, rolle);
    }
    migrieren(sqlite, migrationen, 2);
    const erwartet = ROLLEN.map(([, , neu]) => neu);
    const eingeladen = ["inhaber", "mitglied", "mitglied"];
    const rollen = (sql: string) =>
      sqlite
        .query<{ r: string }, []>(sql)
        .all()
        .map((z) => z.r);
    expect(rollen("SELECT rolle AS r FROM mitglieder ORDER BY nutzer_id")).toEqual(erwartet);
    expect(rollen("SELECT role AS r FROM member ORDER BY user_id")).toEqual(erwartet);
    expect(rollen("SELECT rolle AS r FROM einladungen ORDER BY einladung_id")).toEqual(eingeladen);
    expect(rollen("SELECT role AS r FROM invitation ORDER BY id")).toEqual(eingeladen);
  });
});

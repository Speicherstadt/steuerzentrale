import { describe, expect, it } from "vitest";
import { auditLog, fakten, heartbeats, server } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { faktenAnfuegen, heartbeatAnfuegen } from "./messwerte.ts";
import { schreiben } from "./schreiben.ts";

describe("heartbeatAnfuegen", () => {
  it("appends a heartbeat without an audit entry", () => {
    const { db, schreibDb } = testDatenbank();
    heartbeatAnfuegen(schreibDb, { betreiberId: "b1", serverId: "s1", zeitpunkt: 10, daten: "{}" });
    expect(db.select().from(heartbeats).all()).toEqual([
      { betreiberId: "b1", serverId: "s1", zeitpunkt: 10, daten: "{}" },
    ]);
    expect(db.select().from(auditLog).all()).toEqual([]);
  });

  it("drops a second heartbeat of the same server in the same millisecond", () => {
    const { db, schreibDb } = testDatenbank();
    const zeile = { betreiberId: "b1", serverId: "s1", zeitpunkt: 10, daten: "{}" };
    heartbeatAnfuegen(schreibDb, zeile);
    heartbeatAnfuegen(schreibDb, { ...zeile, daten: '{"zweiter":true}' });
    expect(db.select().from(heartbeats).all()).toEqual([zeile]);
  });
});

describe("faktenAnfuegen", () => {
  const mitServer = () => {
    const offen = testDatenbank();
    for (const betreiberId of ["b1", "b2"])
      schreiben(offen.schreibDb, { betreiberId, akteur: "k", jetzt: 1, grund: "Test" }, "a", (s) =>
        s.einfuegen("server", {
          betreiberId,
          serverId: "s1",
          name: "S",
          art: "gemeinsam",
          wartungsfenster: "{}",
          angelegtVon: "k",
          angelegtAm: 1,
        }),
      );
    return offen;
  };

  it("appends the history and sets the newest at the server, without an audit entry", () => {
    const { db, schreibDb } = mitServer();
    const vorher = db.select().from(auditLog).all().length;
    faktenAnfuegen(schreibDb, {
      betreiberId: "b1",
      serverId: "s1",
      zeitpunkt: 10,
      daten: '{"a":1}',
    });
    faktenAnfuegen(schreibDb, {
      betreiberId: "b1",
      serverId: "s1",
      zeitpunkt: 20,
      daten: '{"a":2}',
    });
    expect(
      db
        .select()
        .from(fakten)
        .all()
        .map((z) => z.zeitpunkt),
    ).toEqual([10, 20]);
    const zeilen = db.select().from(server).all();
    expect(zeilen.map((z) => [z.betreiberId, z.fakten, z.faktenAm])).toEqual([
      ["b1", '{"a":2}', 20],
      ["b2", null, null],
    ]);
    expect(db.select().from(auditLog).all()).toHaveLength(vorher);
  });
});

import { describe, expect, it } from "vitest";
import { auditLog, heartbeats } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { heartbeatAnfuegen } from "./messwerte.ts";

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

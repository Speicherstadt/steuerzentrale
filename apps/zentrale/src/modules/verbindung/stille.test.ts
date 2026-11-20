import { describe, expect, it } from "vitest";
import { auditLog, ereignisse } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { heartbeatAnfuegen, schreiben } from "../audit/index.ts";
import {
  STILL_ART,
  STILL_EREIGNIS_MS,
  STILL_PRUEFUNG_MS,
  stilleSchleife,
  stilleServerMelden,
} from "./stille.ts";

const START = Date.UTC(2026, 10, 20, 12, 0, 0);
const MINUTE = 60_000;

/** A database with joined servers of two operators, one not joined and one revoked */
const mitServern = () => {
  const offen = testDatenbank();
  const server = (betreiberId: string, serverId: string, mehr: Record<string, unknown> = {}) =>
    schreiben(
      offen.schreibDb,
      { betreiberId, akteur: "test", jetzt: START, grund: "Test" },
      "server.anlegen",
      (s) =>
        s.einfuegen("server", {
          betreiberId,
          serverId,
          name: `Server ${serverId}`,
          art: "gemeinsam",
          wartungsfenster: "{}",
          angelegtVon: "test",
          angelegtAm: START,
          beigetretenAm: START,
          fingerabdruck: `${serverId}-fp`,
          ...mehr,
        }),
    );
  server("b1", "s1");
  server("b2", "s2");
  server("b1", "neu", { beigetretenAm: null, fingerabdruck: null });
  server("b1", "weg", { gesperrtAm: START });
  const heartbeat = (betreiberId: string, serverId: string, zeitpunkt: number) =>
    heartbeatAnfuegen(offen.schreibDb, { betreiberId, serverId, zeitpunkt, daten: "{}" });
  const stille = () =>
    offen.db
      .select()
      .from(ereignisse)
      .all()
      .filter((e) => e.art === STILL_ART)
      .map((e) => [e.betreiberId, e.ziel, e.zeitpunkt]);
  return { ...offen, heartbeat, stille };
};

describe("stilleServerMelden", () => {
  it("makes an event for a server three minutes without a heartbeat, and only then", () => {
    const { db, schreibDb, heartbeat, stille } = mitServern();
    heartbeat("b1", "s1", START + MINUTE);
    heartbeat("b2", "s2", START + 2 * MINUTE);
    const nach = (ms: number) => stilleServerMelden(db, schreibDb, ms, START);
    expect(nach(START + MINUTE + STILL_EREIGNIS_MS - 1)).toBe(0);
    expect(nach(START + MINUTE + STILL_EREIGNIS_MS)).toBe(1);
    expect(stille()).toEqual([["b1", "server:s1", START + 4 * MINUTE]]);
    expect(nach(START + 5 * MINUTE)).toBe(1);
    expect(stille()).toContainEqual(["b2", "server:s2", START + 5 * MINUTE]);
  });

  it("makes the event once per silence, and again after heartbeats came back and stopped", () => {
    const { db, schreibDb, heartbeat, stille } = mitServern();
    heartbeat("b2", "s2", START + 60 * MINUTE);
    for (let t = START; t <= START + 30 * MINUTE; t += STILL_PRUEFUNG_MS)
      stilleServerMelden(db, schreibDb, t, START);
    expect(stille().filter(([, z]) => z === "server:s1")).toEqual([
      ["b1", "server:s1", START + 3 * MINUTE],
    ]);
    heartbeat("b1", "s1", START + 31 * MINUTE);
    expect(stilleServerMelden(db, schreibDb, START + 33 * MINUTE, START)).toBe(0);
    stilleServerMelden(db, schreibDb, START + 34 * MINUTE, START);
    expect(stille().filter(([, z]) => z === "server:s1")).toEqual([
      ["b1", "server:s1", START + 3 * MINUTE],
      ["b1", "server:s1", START + 34 * MINUTE],
    ]);
  });

  it("leaves servers that have not joined and revoked servers alone", () => {
    const { db, schreibDb, stille } = mitServern();
    stilleServerMelden(db, schreibDb, START + 60 * MINUTE, START);
    expect(
      stille()
        .map(([, z]) => z)
        .sort(),
    ).toEqual(["server:s1", "server:s2"]);
  });

  it("counts the silence at the earliest from the start of the check", () => {
    const { db, schreibDb, stille } = mitServern();
    const gestartet = START + 60 * MINUTE;
    expect(stilleServerMelden(db, schreibDb, gestartet + MINUTE, gestartet)).toBe(0);
    expect(stilleServerMelden(db, schreibDb, gestartet + 3 * MINUTE, gestartet)).toBe(2);
    expect(stille()).toHaveLength(2);
  });

  it("makes no second event for the same silence after the Zentrale restarted", () => {
    const { db, schreibDb, heartbeat, stille } = mitServern();
    heartbeat("b2", "s2", START + 120 * MINUTE);
    expect(stilleServerMelden(db, schreibDb, START + 3 * MINUTE, START)).toBe(1);
    // a restart (an update of the Zentrale) an hour later, s1 still silent since START
    const neustart = START + 60 * MINUTE;
    expect(stilleServerMelden(db, schreibDb, neustart + 3 * MINUTE, neustart)).toBe(0);
    expect(stille().filter(([, z]) => z === "server:s1")).toEqual([
      ["b1", "server:s1", START + 3 * MINUTE],
    ]);
  });

  it("writes the event through the audit log", () => {
    const { db, schreibDb } = mitServern();
    const vorher = db.select().from(auditLog).all().length;
    stilleServerMelden(db, schreibDb, START + 3 * MINUTE, START, () => "e-1");
    const neu = db.select().from(auditLog).all().slice(vorher);
    expect(neu).toContainEqual(
      expect.objectContaining({
        aktion: "ereignis.server-still",
        akteur: "system",
        ziel: "ereignisse:e-1",
      }),
    );
  });
});

describe("stilleSchleife", () => {
  it("checks every 30 seconds with the clock it is given", () => {
    const { db, schreibDb, stille } = mitServern();
    const uhr = { ms: START };
    const geplant: { lauf: () => void; ms: number }[] = [];
    const zeilen: string[] = [];
    stilleSchleife(
      db,
      schreibDb,
      () => uhr.ms,
      (lauf, ms) => geplant.push({ lauf, ms }),
      (z) => zeilen.push(z),
    );
    expect(geplant.map((g) => g.ms)).toEqual([STILL_PRUEFUNG_MS]);
    uhr.ms = START + 3 * MINUTE;
    geplant[0]?.lauf();
    expect(stille()).toHaveLength(2);
    expect(JSON.parse(zeilen[0] ?? "{}")).toEqual({ msg: "silent servers", gemeldet: 2 });
  });
});

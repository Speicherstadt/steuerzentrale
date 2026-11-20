import { describe, expect, it } from "vitest";
import { auditLog, ereignisse, heartbeats, logAuszuege } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { schreiben } from "../audit/index.ts";
import {
  aufbewahren,
  aufbewahrungsGrenzen,
  aufbewahrungsSchleife,
  monateZurueck,
} from "./index.ts";

const TAG = 24 * 60 * 60 * 1000;
const JETZT = Date.UTC(2026, 10, 20, 12, 0, 0);

describe("monateZurueck", () => {
  it("goes back whole calendar months", () => {
    expect(monateZurueck(JETZT, 13)).toBe(Date.UTC(2025, 9, 20, 12, 0, 0));
  });

  it("takes the last day of a shorter month", () => {
    expect(monateZurueck(Date.UTC(2026, 2, 31), 1)).toBe(Date.UTC(2026, 1, 28));
    expect(monateZurueck(Date.UTC(2025, 2, 31), 13)).toBe(Date.UTC(2024, 1, 29));
  });
});

describe("aufbewahrungsGrenzen", () => {
  it("keeps heartbeats and log excerpts 30 days, events 13 months", () => {
    expect(aufbewahrungsGrenzen(JETZT)).toEqual({
      heartbeats: JETZT - 30 * TAG,
      logAuszuege: JETZT - 30 * TAG,
      ereignisse: Date.UTC(2025, 9, 20, 12, 0, 0),
    });
  });
});

const befuellt = () => {
  const offen = testDatenbank();
  for (const betreiberId of ["b1", "b2"]) {
    const kontext = { betreiberId, akteur: "konto", jetzt: JETZT - 400 * TAG, grund: "Test" };
    schreiben(offen.schreibDb, kontext, "anlegen", (s) => {
      s.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: kontext.jetzt });
      for (const [id, alter] of [
        ["alt", 31],
        ["jung", 29],
      ] as const) {
        s.einfuegen("logAuszuege", {
          betreiberId,
          auszugId: id,
          auftragId: "a",
          zeitpunkt: JETZT - alter * TAG,
          inhalt: "x",
        });
      }
      for (const [id, zeitpunkt] of [
        ["alt", monateZurueck(JETZT, 13) - 1],
        ["jung", monateZurueck(JETZT, 13) + 1],
      ] as const) {
        s.einfuegen("ereignisse", {
          betreiberId,
          ereignisId: id,
          zeitpunkt,
          art: "a",
          schwere: "hinweis",
          ziel: "z",
          text: "t",
        });
      }
    });
    // Heartbeats come from the agent connection (Z-303); here straight into the table
    for (const alter of [31, 30, 1])
      offen.sqlite.run("INSERT INTO heartbeats VALUES (?, 's1', ?, '{}')", [
        betreiberId,
        JETZT - alter * TAG,
      ]);
  }
  return offen;
};

describe("aufbewahren", () => {
  it("deletes old heartbeats, log excerpts and events of every operator and keeps the young", () => {
    const { db, schreibDb } = befuellt();
    expect(aufbewahren(db, schreibDb, JETZT)).toEqual({
      heartbeats: 2,
      logAuszuege: 2,
      ereignisse: 2,
    });
    const alter = (zeilen: { zeitpunkt: number }[]) =>
      zeilen.map((z) => (JETZT - z.zeitpunkt) / TAG).sort();
    expect(alter(db.select().from(heartbeats).all())).toEqual([1, 1, 30, 30]);
    expect(
      db
        .select()
        .from(logAuszuege)
        .all()
        .map((z) => z.auszugId),
    ).toEqual(["jung", "jung"]);
    expect(
      db
        .select()
        .from(ereignisse)
        .all()
        .map((z) => z.ereignisId),
    ).toEqual(["jung", "jung"]);
  });

  it("leaves the audit log whole, however old, and records the run in it", () => {
    const { db, schreibDb } = befuellt();
    const vorher = db.select().from(auditLog).all();
    expect(vorher.every((e) => e.zeitpunkt === JETZT - 400 * TAG)).toBe(true);
    aufbewahren(db, schreibDb, JETZT);
    const nachher = db.select().from(auditLog).all();
    expect(nachher.slice(0, vorher.length)).toEqual(vorher);
    expect(nachher.slice(vorher.length).map((e) => [e.betreiberId, e.aktion, e.akteur])).toEqual(
      expect.arrayContaining([
        ["b1", "aufbewahrung", "system"],
        ["b2", "aufbewahrung", "system"],
      ]),
    );
  });
});

describe("aufbewahrungsSchleife", () => {
  it("runs at once and then once a day", () => {
    const { db, schreibDb } = befuellt();
    const geplant: number[] = [];
    const zeilen: string[] = [];
    aufbewahrungsSchleife(
      db,
      schreibDb,
      () => JETZT,
      (_lauf, ms) => geplant.push(ms),
      (z) => zeilen.push(z),
    );
    expect(geplant).toEqual([TAG]);
    expect(JSON.parse(zeilen[0] ?? "")).toMatchObject({ msg: "retention" });
    expect(db.select().from(logAuszuege).all()).toHaveLength(2);
  });
});

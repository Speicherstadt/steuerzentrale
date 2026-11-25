import { describe, expect, it } from "vitest";
import {
  auditLog,
  ereignisse,
  fakten,
  heartbeats,
  installationVerlauf,
  logAuszuege,
  verfuegbarkeit,
} from "../../db/schema.ts";
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
  it("keeps heartbeats, facts, log excerpts and deliveries 30 days, the rating's history 90, events, backups, test restores and the hourly checks from outside 13 months", () => {
    expect(aufbewahrungsGrenzen(JETZT)).toEqual({
      heartbeats: JETZT - 30 * TAG,
      fakten: JETZT - 30 * TAG,
      logAuszuege: JETZT - 30 * TAG,
      zustellungen: JETZT - 30 * TAG,
      installationVerlauf: JETZT - 90 * TAG,
      ereignisse: Date.UTC(2025, 9, 20, 12, 0, 0),
      backups: Date.UTC(2025, 9, 20, 12, 0, 0),
      pruefRestores: Date.UTC(2025, 9, 20, 12, 0, 0),
      verfuegbarkeit: Date.UTC(2025, 9, 20, 12, 0, 0),
      dienstVerfuegbarkeit: Date.UTC(2025, 9, 20, 12, 0, 0),
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
        // a delivery of a notification (Z-703)
        s.einfuegen("zustellungen", {
          betreiberId,
          zustellungId: `e.${id}`,
          ereignisId: "e",
          empfaengerId: id,
          schwere: "fehler",
          zustand: "zugestellt",
          versuche: 1,
          faelligAm: JETZT - alter * TAG,
          angelegtAm: JETZT - alter * TAG,
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
    // the facts' history (Z-304), likewise
    for (const alter of [31, 1])
      offen.sqlite.run("INSERT INTO fakten VALUES (?, 's1', ?, '{}')", [
        betreiberId,
        JETZT - alter * TAG,
      ]);
    // the history of ratings (Z-403), a measurement too; its installation does not matter here
    offen.sqlite.run("PRAGMA foreign_keys = OFF");
    for (const alter of [91, 89])
      offen.sqlite.run("INSERT INTO installation_verlauf VALUES (?, 'i1', ?, 'rot', '{}')", [
        betreiberId,
        JETZT - alter * TAG,
      ]);
    // the hourly counts of the checks from outside (Z-704), a measurement too
    for (const stunde of [monateZurueck(JETZT, 13) - 3_600_000, monateZurueck(JETZT, 13)])
      offen.sqlite.run("INSERT INTO verfuegbarkeit VALUES (?, 'i1', ?, 60, 0)", [
        betreiberId,
        stunde,
      ]);
    offen.sqlite.run("PRAGMA foreign_keys = ON");
  }
  return offen;
};

const alterIn = (zeilen: { zeitpunkt: number }[]) =>
  zeilen.map((z) => (JETZT - z.zeitpunkt) / TAG).sort();

describe("aufbewahren", () => {
  it("deletes old heartbeats, facts, log excerpts, deliveries, history and events of every operator and keeps the young", () => {
    const { db, schreibDb } = befuellt();
    expect(aufbewahren(db, schreibDb, JETZT)).toEqual({
      heartbeats: 2,
      fakten: 2,
      logAuszuege: 2,
      zustellungen: 2,
      installationVerlauf: 2,
      ereignisse: 2,
      backups: 0,
      pruefRestores: 0,
      verfuegbarkeit: 2,
      dienstVerfuegbarkeit: 0,
    });
    expect(alterIn(db.select().from(installationVerlauf).all())).toEqual([89, 89]);
    expect(
      db
        .select()
        .from(verfuegbarkeit)
        .all()
        .map((z) => z.stunde),
    ).toEqual([monateZurueck(JETZT, 13), monateZurueck(JETZT, 13)]);
    expect(alterIn(db.select().from(heartbeats).all())).toEqual([1, 1, 30, 30]);
    expect(alterIn(db.select().from(fakten).all())).toEqual([1, 1]);
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

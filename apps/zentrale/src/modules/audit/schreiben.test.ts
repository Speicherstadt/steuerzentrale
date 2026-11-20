import { describe, expect, it } from "vitest";
import { auditLog, betreiber, logAuszuege } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { type Kontext, schreiben } from "./schreiben.ts";

const kontext: Kontext = { betreiberId: "b1", akteur: "konto-1", jetzt: 1000, grund: "Test" };

const mitBetreiber = () => {
  const offen = testDatenbank();
  schreiben(offen.schreibDb, kontext, "betreiber.anlegen", (s) =>
    s.einfuegen("betreiber", { betreiberId: "b1", name: "Eins", angelegtAm: 1000 }),
  );
  return offen;
};

const auszug = (id: string, zeitpunkt = 1000, betreiberId = "b1") => ({
  betreiberId,
  auszugId: id,
  auftragId: "a1",
  zeitpunkt,
  inhalt: "Zeile",
});

describe("schreiben", () => {
  it("appends actor, time, action, target and reason with every insert", () => {
    const { db } = mitBetreiber();
    expect(db.select().from(auditLog).all()).toEqual([
      expect.objectContaining({
        betreiberId: "b1",
        zeitpunkt: 1000,
        akteur: "konto-1",
        aktion: "betreiber.anlegen",
        ziel: "betreiber",
        grund: "Test",
      }),
    ]);
  });

  it("records changes and deletions with their target", () => {
    const { db, schreibDb } = mitBetreiber();
    schreiben(schreibDb, kontext, "auszug", (s) => {
      s.einfuegen("logAuszuege", auszug("x"));
      s.aendern("logAuszuege", { auszugId: "x" }, { inhalt: "neu" });
      s.loeschen("logAuszuege", { auszugId: "x" });
    });
    const eintraege = db.select().from(auditLog).all().slice(1);
    expect(eintraege.map((e) => [e.ziel, JSON.parse(e.inhalt).art])).toEqual([
      ["logAuszuege:x", "einfuegen"],
      ["logAuszuege:x", "aendern"],
      ["logAuszuege:x", "loeschen"],
    ]);
    expect(db.select().from(logAuszuege).all()).toEqual([]);
  });

  it("takes back rows and entries together when the transaction fails midway", () => {
    const { db, schreibDb } = mitBetreiber();
    expect(() =>
      schreiben(schreibDb, kontext, "auszug", (s) => {
        s.einfuegen("logAuszuege", auszug("x"));
        throw new Error("mitten drin");
      }),
    ).toThrow("mitten drin");
    expect(db.select().from(logAuszuege).all()).toEqual([]);
    expect(db.select().from(auditLog).all()).toHaveLength(1);
  });

  it("refuses a row of another operator", () => {
    const { schreibDb } = mitBetreiber();
    expect(() =>
      schreiben(schreibDb, kontext, "auszug", (s) =>
        s.einfuegen("logAuszuege", auszug("x", 1, "b2")),
      ),
    ).toThrow("row of another operator");
  });

  it("does not change or delete a row of another operator", () => {
    const { db, schreibDb } = mitBetreiber();
    const fremd = { ...kontext, betreiberId: "b2" };
    schreiben(schreibDb, fremd, "betreiber.anlegen", (s) =>
      s.einfuegen("betreiber", { betreiberId: "b2", name: "Zwei", angelegtAm: 1 }),
    );
    schreiben(schreibDb, fremd, "auszug", (s) => s.einfuegen("logAuszuege", auszug("x", 1, "b2")));
    expect(() =>
      schreiben(schreibDb, kontext, "auszug", (s) =>
        s.aendern("logAuszuege", { auszugId: "x" }, { inhalt: "!" }),
      ),
    ).toThrow("expected one row, found 0");
    expect(() =>
      schreiben(schreibDb, kontext, "auszug", (s) => s.loeschen("logAuszuege", { auszugId: "x" })),
    ).toThrow("expected one row, found 0");
    expect(db.select().from(logAuszuege).all()).toEqual([
      expect.objectContaining({ inhalt: "Zeile" }),
    ]);
  });

  it("refuses a change without the full key", () => {
    const { schreibDb } = mitBetreiber();
    expect(() =>
      schreiben(schreibDb, kontext, "auszug", (s) => s.loeschen("logAuszuege", {})),
    ).toThrow("key auszugId missing");
  });

  it("keeps the operator id of a row when a change names another", () => {
    const { db, schreibDb } = mitBetreiber();
    schreiben(schreibDb, kontext, "auszug", (s) => {
      s.einfuegen("logAuszuege", auszug("x"));
      s.aendern("logAuszuege", { auszugId: "x" }, { betreiberId: "b2", inhalt: "neu" });
    });
    expect(db.select().from(logAuszuege).all()).toEqual([
      expect.objectContaining({ betreiberId: "b1", inhalt: "neu" }),
    ]);
  });
});

describe("audit log", () => {
  it("cannot be changed or deleted, not even over the writable connection", () => {
    const { sqlite, db } = mitBetreiber();
    expect(() => sqlite.run("UPDATE audit_log SET grund = 'anders'")).toThrow("append-only");
    expect(() => sqlite.run("DELETE FROM audit_log")).toThrow("append-only");
    expect(db.select().from(auditLog).all()).toHaveLength(1);
    expect(db.select().from(betreiber).all()).toHaveLength(1);
  });
});

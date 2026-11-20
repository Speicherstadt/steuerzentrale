import { describe, expect, it } from "vitest";
import { auditLog, betreiber } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { type Kontext, schreiben } from "./schreiben.ts";

const kontext: Kontext = { betreiberId: "b1", akteur: "konto-1", jetzt: 1000, grund: "Test" };

describe("schreiben with an async change", () => {
  it("leaves no row and no entry behind when the change fails after an await", async () => {
    const { db, schreibDb } = testDatenbank();
    const lauf = (async () =>
      schreiben(schreibDb, kontext, "betreiber.anlegen", async (s) => {
        s.einfuegen("betreiber", { betreiberId: "b1", name: "Eins", angelegtAm: 1000 });
        await Promise.resolve();
        throw new Error("mitten drin");
      }))();
    await expect(lauf).rejects.toThrow();
    expect(db.select().from(betreiber).all()).toEqual([]);
    expect(db.select().from(auditLog).all()).toEqual([]);
  });
});

describe("schreiben after its transaction", () => {
  it("refuses a write that comes after an await", async () => {
    const { db, schreibDb } = testDatenbank();
    let spaet: Promise<unknown> = Promise.resolve();
    expect(() =>
      schreiben(schreibDb, kontext, "betreiber.anlegen", (s) => {
        spaet = Promise.resolve().then(() =>
          s.einfuegen("betreiber", { betreiberId: "b1", name: "Eins", angelegtAm: 1000 }),
        );
      }),
    ).not.toThrow();
    await expect(spaet).rejects.toThrow("write after the transaction ended");
    expect(db.select().from(betreiber).all()).toEqual([]);
    expect(db.select().from(auditLog).all()).toEqual([]);
  });
});

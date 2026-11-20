import { describe, expect, it } from "vitest";
import { auditLog, tokens } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { schreiben } from "../audit/index.ts";
import {
  EINRICHTUNG_GUELTIG_MS,
  einrichtungOffen,
  einrichtungscodeEinloesen,
  einrichtungscodeErzeugen,
} from "./einrichtungscode.ts";

const START = 1_800_000_000_000;

const mitCode = () => {
  const offen = testDatenbank();
  const erzeugt = einrichtungscodeErzeugen(offen.db, offen.schreibDb, START);
  if (!erzeugt) throw new Error("no code");
  return { ...offen, ...erzeugt };
};

describe("the setup code", () => {
  it("is valid for 24 hours and stored only as its hash", () => {
    const { db, code, gueltigBis } = mitCode();
    expect(gueltigBis).toBe(START + EINRICHTUNG_GUELTIG_MS);
    expect(code.length).toBeGreaterThanOrEqual(43);
    const zeilen = db.select().from(tokens).all();
    expect(zeilen).toHaveLength(1);
    expect(JSON.stringify(zeilen)).not.toContain(code);
    expect(JSON.stringify(db.select().from(auditLog).all())).not.toContain(code);
  });

  it("is accepted once, with the operator id it reserved", () => {
    const { db, schreibDb, code } = mitCode();
    const [zeile] = db.select().from(tokens).all();
    expect(einrichtungscodeEinloesen(db, schreibDb, code, START + 1)).toEqual({
      ok: true,
      betreiberId: zeile?.betreiberId,
    });
    expect(einrichtungscodeEinloesen(db, schreibDb, code, START + 2)).toEqual({
      ok: false,
      grund: "ungueltig",
    });
  });

  it("is refused after 24 hours", () => {
    const { db, schreibDb, code } = mitCode();
    expect(einrichtungscodeEinloesen(db, schreibDb, code, START + EINRICHTUNG_GUELTIG_MS)).toEqual({
      ok: false,
      grund: "ungueltig",
    });
    expect(
      einrichtungscodeEinloesen(db, schreibDb, code, START + EINRICHTUNG_GUELTIG_MS - 1).ok,
    ).toBe(true);
  });

  it("refuses a wrong code", () => {
    const { db, schreibDb } = mitCode();
    expect(einrichtungscodeEinloesen(db, schreibDb, "falsch", START).ok).toBe(false);
  });

  it("of an earlier start is replaced by the code of the next", () => {
    const { db, schreibDb, code } = mitCode();
    const neu = einrichtungscodeErzeugen(db, schreibDb, START + 10);
    expect(neu?.code).not.toBe(code);
    expect(einrichtungscodeEinloesen(db, schreibDb, code, START + 11).ok).toBe(false);
    expect(einrichtungscodeEinloesen(db, schreibDb, neu?.code ?? "", START + 11).ok).toBe(true);
  });

  it("is neither made nor accepted once the operator has a member", () => {
    const { db, schreibDb, code } = mitCode();
    const kontext = { betreiberId: "b1", akteur: "test", jetzt: START, grund: "Test" };
    schreiben(schreibDb, kontext, "mitglied", (s) =>
      s.einfuegen("mitglieder", {
        betreiberId: "b1",
        nutzerId: "n1",
        rolle: "inhaber",
        angelegtAm: START,
      }),
    );
    expect(einrichtungOffen(db)).toBe(false);
    expect(einrichtungscodeErzeugen(db, schreibDb, START + 1)).toBeUndefined();
    expect(einrichtungscodeEinloesen(db, schreibDb, code, START + 1)).toEqual({
      ok: false,
      grund: "abgeschlossen",
    });
  });
});

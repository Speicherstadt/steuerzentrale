import { describe, expect, it } from "vitest";
import { logAuszuege } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { schreiben } from "../audit/index.ts";
import { aufbewahren } from "./index.ts";

const TAG = 24 * 60 * 60 * 1000;
const JETZT = Date.UTC(2026, 10, 20, 12, 0, 0);

describe("aufbewahren after an operator was deleted", () => {
  it("still deletes the operator's old log excerpts", () => {
    const { db, schreibDb } = testDatenbank();
    const kontext = { betreiberId: "b1", akteur: "konto", jetzt: JETZT - 40 * TAG, grund: "Test" };
    schreiben(schreibDb, kontext, "anlegen", (s) => {
      s.einfuegen("betreiber", { betreiberId: "b1", name: "Eins", angelegtAm: kontext.jetzt });
      s.einfuegen("logAuszuege", {
        betreiberId: "b1",
        auszugId: "alt",
        auftragId: "a",
        zeitpunkt: JETZT - 31 * TAG,
        inhalt: "personenbezogen",
      });
    });
    schreiben(schreibDb, kontext, "betreiber.loeschen", (s) => s.loeschen("betreiber", {}));
    aufbewahren(db, schreibDb, JETZT);
    expect(db.select().from(logAuszuege).all()).toEqual([]);
  });
});

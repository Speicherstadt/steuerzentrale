import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { type Stand, standLaden, standSchreiber, standText, VERGESSEN_NACH_MS } from "./zustand.ts";

/* BAULISTE.md Z-305: the agent's record of its jobs, written atomically, read back after a restart */
const JETZT = 1_800_000_000_000;

describe("the record of jobs", () => {
  it("reads back what was written, and is empty before the first job", async () => {
    const fs = speicher();
    expect(await standLaden(fs.dateien, "/z/a.json")).toEqual({ ok: true, stand: new Map() });
    const stand: Stand = new Map([
      ["a1", { zustand: "laeuft", am: JETZT }],
      ["a2", { zustand: "fertig", am: JETZT, ergebnis: { ok: false, fehler: "x" } }],
    ]);
    await standSchreiber(fs.dateien, "/z/a.json", () => JETZT)(stand);
    expect(await standLaden(fs.dateien, "/z/a.json")).toEqual({ ok: true, stand });
  });

  it("forgets finished jobs after 30 days, never a running one", () => {
    const alt = JETZT - VERGESSEN_NACH_MS;
    const stand: Stand = new Map([
      ["laeuft", { zustand: "laeuft", am: alt }],
      ["alt", { zustand: "fertig", am: alt, ergebnis: { ok: true, daten: {} } }],
      ["neu", { zustand: "fertig", am: alt + 1, ergebnis: { ok: true, daten: {} } }],
    ]);
    expect(Object.keys(JSON.parse(standText(stand, JETZT)).auftraege)).toEqual(["laeuft", "neu"]);
  });

  it("is an error when it is not the agent's, never an empty record", async () => {
    for (const text of ["kaputt", "{}", JSON.stringify({ auftraege: { a: { zustand: "x" } } })])
      expect(await standLaden(speicher({ "/z/a.json": text }).dateien, "/z/a.json")).toMatchObject({
        ok: false,
      });
  });

  it("writes one after the other, the last state last", async () => {
    const fs = speicher();
    const schreibe = standSchreiber(fs.dateien, "/z/a.json", () => JETZT);
    const stand: Stand = new Map();
    stand.set("a1", { zustand: "laeuft", am: JETZT });
    const erst = schreibe(stand);
    stand.set("a1", { zustand: "fertig", am: JETZT, ergebnis: { ok: true, daten: {} } });
    await Promise.all([erst, schreibe(stand)]);
    expect(JSON.parse(fs.inhalt.get("/z/a.json")?.text ?? "{}").auftraege.a1.zustand).toBe(
      "fertig",
    );
  });
});

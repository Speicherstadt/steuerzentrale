import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { gedaechtnisOeffnen } from "./gedaechtnis.ts";

/* docs/plan.md, "Scheitern beim Einrichten": the agent's record of the installations it made */

const PFAD = "/z/installationen.json";

describe("the record of installations", () => {
  it("is empty without a file, and written atomically with mode 0600", async () => {
    const fs = speicher();
    const g = gedaechtnisOeffnen(fs.dateien, PFAD, () => 7);
    expect(await g.lesen()).toEqual({ ok: true, stand: new Map() });
    await g.setzen("a", "angelegt");
    await g.setzen("a", "fertig");
    await g.setzen("b", "angelegt");
    await g.setzen("b", undefined);
    expect(JSON.parse(fs.inhalt.get(PFAD)?.text ?? "")).toEqual({
      installationen: { a: { zustand: "fertig", am: 7 } },
    });
    expect(fs.inhalt.get(PFAD)?.modus).toBe(0o600);
  });

  it("is read back after a restart", async () => {
    const fs = speicher();
    await gedaechtnisOeffnen(fs.dateien, PFAD, () => 7).setzen("a", "fertig");
    const neu = await gedaechtnisOeffnen(fs.dateien, PFAD, () => 8).lesen();
    expect(neu.ok && neu.stand.get("a")).toEqual({ zustand: "fertig", am: 7 });
  });

  it("keeps what the health check of a finished installation needs (Z-403)", async () => {
    const fs = speicher();
    const pruefung = {
      units: ["a-app.service"],
      ziel: { art: "http" as const, port: 20001, pfad: "/health" },
    };
    await gedaechtnisOeffnen(fs.dateien, PFAD, () => 7).setzen("a", "fertig", pruefung);
    await gedaechtnisOeffnen(fs.dateien, PFAD, () => 8).setzen("b", "angelegt");
    const neu = await gedaechtnisOeffnen(fs.dateien, PFAD, () => 9).lesen();
    expect(neu.ok && neu.stand.get("a")).toEqual({ zustand: "fertig", am: 7, pruefung });
    expect(neu.ok && neu.stand.get("b")).toEqual({ zustand: "angelegt", am: 8 });
  });

  it("reads an entry from before Z-403 without them", async () => {
    const fs = speicher({ [PFAD]: '{"installationen":{"a":{"zustand":"fertig","am":1}}}' });
    const g = await gedaechtnisOeffnen(fs.dateien, PFAD, () => 7).lesen();
    expect(g.ok && g.stand.get("a")).toEqual({ zustand: "fertig", am: 1 });
  });

  it("unreadable is an error, never an empty record, until it is repaired", async () => {
    const fs = speicher({ [PFAD]: '{"installationen":{"a":{"zustand":"vielleicht"}}}' });
    const g = gedaechtnisOeffnen(fs.dateien, PFAD, () => 7);
    expect(await g.lesen()).toEqual({
      ok: false,
      grund: `${PFAD} is not the agent's record of installations`,
    });
    await expect(g.setzen("b", "angelegt")).rejects.toThrow();
    fs.inhalt.set(PFAD, { text: '{"installationen":{}}', modus: 0o600 });
    expect(await g.lesen()).toMatchObject({ ok: true });
  });
});

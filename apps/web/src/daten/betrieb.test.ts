import { describe, expect, it } from "vitest";
import { demoBetrieb, seiteAus } from "../demo/betrieb-quelle.ts";
import { abfrage, type Seite } from "./betrieb.ts";

/*
 * BAULISTE.md Z-406: the lists ask the Zentrale with repeated filters and a cursor; the demo answers
 * as the API does, page by page, every row once.
 */
describe("abfrage", () => {
  it("repeats each filter value and adds the cursor", () => {
    expect(abfrage({ zustand: ["wartend", "laeuft"], serverId: [] }, "abc")).toBe(
      "?zustand=wartend&zustand=laeuft&weiter=abc",
    );
    expect(abfrage({ ziel: ["installation:a b"] })).toBe("?ziel=installation%3Aa+b");
    expect(abfrage({})).toBe("");
  });
});

const alle = async <T>(laden: (weiter?: string) => Promise<{ ok: boolean; daten?: Seite<T> }>) => {
  const gelesen: T[] = [];
  let weiter: string | undefined;
  do {
    const a = await laden(weiter);
    if (!a.ok || !a.daten) throw new Error("refused");
    gelesen.push(...a.daten.eintraege);
    weiter = a.daten.weiter ?? undefined;
  } while (weiter);
  return gelesen;
};

describe("the demo's operations", () => {
  it("hand out every row once, page by page", async () => {
    expect(seiteAus([1, 2, 3, 4, 5], undefined, 2)).toEqual({ eintraege: [1, 2], weiter: "2" });
    expect(seiteAus([1, 2, 3, 4, 5], "4", 2)).toEqual({ eintraege: [5], weiter: null });
    const quelle = demoBetrieb();
    const ereignisse = await alle((w) => quelle.ereignisse({}, w) as never);
    const ids = ereignisse.map((e) => (e as { ereignisId: string }).ereignisId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filter as the Zentrale does: severity, state and target", async () => {
    const quelle = demoBetrieb();
    const fehler = await quelle.ereignisse({ schwere: ["fehler"] });
    expect(fehler.ok && fehler.daten.eintraege.every((e) => e.schwere === "fehler")).toBe(true);
    const gescheitert = await quelle.auftraege({ zustand: ["gescheitert"] });
    expect(gescheitert.ok && gescheitert.daten.eintraege.length).toBeGreaterThan(0);
    const ziel = await quelle.ereignisse({ ziel: ["server:shared-2"] });
    expect(ziel.ok && ziel.daten.eintraege.every((e) => e.ziel === "server:shared-2")).toBe(true);
  });

  it("order the overview by severity, each entry with its cause", async () => {
    const a = await demoBetrieb().uebersicht();
    if (!a.ok) throw new Error("refused");
    const rang = { stoerung: 0, warnung: 1, hinweis: 2 };
    const schweren = a.daten.map((e) => rang[e.schwere]);
    expect(schweren).toEqual([...schweren].sort((x, y) => x - y));
    expect(a.daten[0]).toMatchObject({
      art: "stoerung",
      verweis: { art: "installation", id: "berger-schreibzeug" },
    });
  });
});

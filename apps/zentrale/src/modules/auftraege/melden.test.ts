import { describe, expect, it } from "vitest";
import { auditLog, auftraege } from "../../db/schema.ts";
import { auftragsUmgebung, neuerAuftrag } from "../../testhilfen/auftraege.ts";
import { auftragAnlegen } from "./anlegen.ts";
import { auftragMelden } from "./melden.ts";

/*
 * BAULISTE.md Z-305: the agent acknowledges a job, reports steps and its result; each change of
 * state stands in the audit log, a step of a running job is a measurement, and a report sent twice
 * changes nothing.
 */
const SERVER = { betreiberId: "b1", serverId: "s1" } as never;

const aufgebaut = () => {
  const u = auftragsUmgebung();
  u.betreiber("b1", "s1");
  u.verbinden("b1", "s1");
  auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "a1" }));
  const auftrag = () => u.db.select().from(auftraege).get();
  const audit = () =>
    u.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.ziel === "auftraege:a1");
  return { ...u, auftrag, audit };
};

const fortschritt = (schritt: string) =>
  ({ typ: "fortschritt", protokoll: 1, auftragId: "a1", schritt, zeit: 1 }) as const;

describe("the agent's reports", () => {
  it("move a job from acknowledged to running to success, each change in the audit log", () => {
    const u = aufgebaut();
    expect(
      auftragMelden(u.deps, SERVER, { typ: "bestaetigt", protokoll: 1, auftragId: "a1" }, 2),
    ).toEqual({
      ok: true,
      geaendert: true,
    });
    expect(u.auftrag()?.zustand).toBe("bestaetigt");
    auftragMelden(u.deps, SERVER, fortschritt("migrieren"), 3);
    expect(u.auftrag()).toMatchObject({
      zustand: "laeuft",
      fortschritt: "migrieren",
      fortschrittAm: 3,
    });
    const vorher = u.audit().length;
    // a further step is a measurement: no audit entry
    expect(auftragMelden(u.deps, SERVER, fortschritt("noch dabei"), 4)).toEqual({
      ok: true,
      geaendert: false,
    });
    expect(u.auftrag()).toMatchObject({ fortschritt: "noch dabei", fortschrittAm: 4 });
    expect(u.audit()).toHaveLength(vorher);
    const ergebnis = {
      typ: "ergebnis",
      protokoll: 1,
      auftragId: "a1",
      zeit: 5,
      ergebnis: { ok: true, daten: { code: 0 } },
    } as const;
    auftragMelden(u.deps, SERVER, ergebnis, 5);
    expect(u.auftrag()).toMatchObject({
      zustand: "erfolgreich",
      geaendertAm: 5,
      ergebnis: JSON.stringify({ ok: true, daten: { code: 0 } }),
    });
    expect(u.audit().map((e) => [e.aktion, e.akteur])).toEqual([
      ["auftrag.anlegen", "nutzer-1"],
      ["auftrag.zugestellt", "system"],
      ["auftrag.bestaetigt", "server:s1"],
      ["auftrag.fortschritt", "server:s1"],
      ["auftrag.ergebnis", "server:s1"],
    ]);
    // the same result again (the agent answered a job sent twice): nothing changes
    expect(auftragMelden(u.deps, SERVER, ergebnis, 6)).toEqual({ ok: true, geaendert: false });
    expect(u.audit()).toHaveLength(5);
    // an acknowledgement after the end changes nothing either
    auftragMelden(u.deps, SERVER, { typ: "bestaetigt", protokoll: 1, auftragId: "a1" }, 7);
    expect(u.auftrag()?.zustand).toBe("erfolgreich");
  });

  it("refuse a result that contradicts the known one, and a step after the end", () => {
    const u = aufgebaut();
    const gescheitert = {
      typ: "ergebnis",
      protokoll: 1,
      auftragId: "a1",
      zeit: 2,
      ergebnis: { ok: false, fehler: "exit code 1" },
    } as const;
    auftragMelden(u.deps, SERVER, gescheitert, 2);
    const anders = { ...gescheitert, ergebnis: { ok: true, daten: {} } } as const;
    expect(auftragMelden(u.deps, SERVER, anders, 3)).toEqual({
      ok: false,
      grund: "ergebnis is not possible for a job that is gescheitert",
    });
    expect(auftragMelden(u.deps, SERVER, fortschritt("x"), 3)).toMatchObject({ ok: false });
    expect(u.auftrag()).toMatchObject({ zustand: "gescheitert", fortschritt: null });
  });

  it("refuse a report for a job the Zentrale never sent", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "a1" }));
    expect(auftragMelden(u.deps, SERVER, fortschritt("x"), 2)).toEqual({
      ok: false,
      grund: "fortschritt is not possible for a job that is bereit",
    });
  });
});

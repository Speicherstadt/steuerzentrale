import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AUFTRAG_ZUSTAENDE,
  type AuftragEreignis,
  type AuftragZustand,
  ENDZUSTAENDE,
  uebergang,
} from "./auftraege.ts";

/* BAULISTE.md Z-305: the states of a job, wartend → bereit → zugestellt → bestaetigt/laeuft → end */

const EREIGNISSE: AuftragEreignis[] = [
  { art: "vorgaenger_erfolgreich" },
  { art: "vorgaenger_gescheitert" },
  { art: "zugestellt" },
  { art: "abbrechen" },
  { art: "bestaetigt" },
  { art: "fortschritt" },
  { art: "ergebnis", ok: true },
  { art: "ergebnis", ok: false },
];

const lauf = (start: AuftragZustand, ereignisse: AuftragEreignis[]) =>
  ereignisse.reduce<AuftragZustand>((z, e) => {
    const u = uebergang(z, e);
    if (!u.ok) throw new Error(u.grund);
    return u.zustand;
  }, start);

describe("a job", () => {
  it("runs its course from waiting to success", () => {
    expect(
      lauf("wartend", [
        { art: "vorgaenger_erfolgreich" },
        { art: "zugestellt" },
        { art: "bestaetigt" },
        { art: "fortschritt" },
        { art: "fortschritt" },
        { art: "ergebnis", ok: true },
      ]),
    ).toBe("erfolgreich");
  });

  it("may report its result without acknowledging or progress first", () => {
    expect(lauf("bereit", [{ art: "zugestellt" }, { art: "ergebnis", ok: false }])).toBe(
      "gescheitert",
    );
  });

  it("is cancelled when a predecessor fails, before it ever went to an agent", () => {
    expect(lauf("wartend", [{ art: "vorgaenger_gescheitert" }])).toBe("abgebrochen");
    expect(uebergang("bereit", { art: "vorgaenger_gescheitert" })).toMatchObject({ ok: false });
  });

  it("takes a message sent twice without a change", () => {
    expect(uebergang("bestaetigt", { art: "bestaetigt" })).toEqual({
      ok: true,
      zustand: "bestaetigt",
      geaendert: false,
    });
    expect(uebergang("erfolgreich", { art: "ergebnis", ok: true })).toEqual({
      ok: true,
      zustand: "erfolgreich",
      geaendert: false,
    });
    expect(uebergang("laeuft", { art: "zugestellt" })).toMatchObject({
      zustand: "laeuft",
      geaendert: false,
    });
  });

  it.each([
    ["wartend", { art: "zugestellt" }],
    ["wartend", { art: "ergebnis", ok: true }],
    ["bereit", { art: "bestaetigt" }],
    ["bereit", { art: "fortschritt" }],
    ["erfolgreich", { art: "ergebnis", ok: false }],
    ["gescheitert", { art: "ergebnis", ok: true }],
    ["laeuft", { art: "vorgaenger_gescheitert" }],
    ["erfolgreich", { art: "fortschritt" }],
    ["abgebrochen", { art: "vorgaenger_erfolgreich" }],
  ] as [AuftragZustand, AuftragEreignis][])("refuses %s → %j as an error value", (von, e) => {
    expect(uebergang(von, e)).toEqual({
      ok: false,
      grund: `${e.art} is not possible for a job that is ${von}`,
    });
  });

  it("is cancelled by the Zentrale only before its agent acknowledged it (Z-701)", () => {
    expect(lauf("bereit", [{ art: "abbrechen" }])).toBe("abgebrochen");
    expect(lauf("zugestellt", [{ art: "abbrechen" }])).toBe("abgebrochen");
    for (const von of ["wartend", "bestaetigt", "laeuft"] as const)
      expect(uebergang(von, { art: "abbrechen" })).toEqual({
        ok: false,
        grund: `abbrechen is not possible for a job that is ${von}`,
      });
    // an agent that acknowledges it afterwards changes nothing
    expect(uebergang("abgebrochen", { art: "bestaetigt" }).ok).toBe(false);
  });

  it("never leaves an end state, whatever comes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ENDZUSTAENDE),
        fc.array(fc.constantFrom(...EREIGNISSE)),
        (ende, ereignisse) => {
          let z: AuftragZustand = ende;
          for (const e of ereignisse) {
            const u = uebergang(z, e);
            if (u.ok) z = u.zustand;
          }
          expect(z).toBe(ende);
        },
      ),
    );
  });

  it("knows every state", () => {
    expect(AUFTRAG_ZUSTAENDE).toHaveLength(8);
  });
});

import type { MonatsVerfuegbarkeit } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import type { AppZeile, Stufe } from "./apps-liste.ts";
import { kundeStand, verfuegbarkeitsTabelle } from "./kunde-ansicht.ts";

const zeile = (stufe: Stufe) => ({ stufe }) as AppZeile;

describe("a customer's apps in one sentence", () => {
  it("says none, all well, being set up or updated, or how many need someone", () => {
    expect(kundeStand([])).toEqual({ art: "keine" });
    expect(kundeStand([zeile("gut"), zeile("gut")])).toEqual({ art: "laufen", apps: 2 });
    expect(kundeStand([zeile("gut"), zeile("unterwegs")])).toEqual({
      art: "unterwegs",
      apps: 2,
      unterwegs: 1,
    });
    expect(kundeStand([zeile("unterwegs"), zeile("rot"), zeile("unbekannt")])).toEqual({
      art: "braucht",
      apps: 3,
      braucht: 2,
    });
  });
});

// 20 November 2026 in Berlin
const JETZT = Date.UTC(2026, 10, 20, 9, 42);

const monat = (m: number, gemessen: number, rot: number): MonatsVerfuegbarkeit => ({
  jahr: 2026,
  monat: m,
  minuten: gemessen,
  gemessen,
  rot,
  anteil: gemessen === 0 ? null : (gemessen - rot) / gemessen,
});

describe("the availability per month of a customer's apps", () => {
  it("has the last months oldest first, a cell per app, and all apps together", () => {
    const t = verfuegbarkeitsTabelle(
      [
        { id: "a", monate: [monat(11, 1000, 0), monat(10, 1000, 2)] },
        { id: "b", monate: [monat(11, 1000, 0)] },
      ],
      3,
      JETZT,
    );
    expect(t.monate).toEqual([
      { jahr: 2026, monat: 9 },
      { jahr: 2026, monat: 10 },
      { jahr: 2026, monat: 11 },
    ]);
    expect(t.zeilen).toEqual([
      {
        id: "a",
        zellen: [
          { anteil: null, unterZiel: false },
          { anteil: 0.998, unterZiel: true },
          { anteil: 1, unterZiel: false },
        ],
      },
      {
        id: "b",
        zellen: [
          { anteil: null, unterZiel: false },
          { anteil: null, unterZiel: false },
          { anteil: 1, unterZiel: false },
        ],
      },
    ]);
    // October: only app a measured; November: 2000 minutes, none red
    expect(t.gesamt).toEqual([
      { anteil: null, unterZiel: false },
      { anteil: 0.998, unterZiel: true },
      { anteil: 1, unterZiel: false },
    ]);
  });

  it("counts the whole by minutes, so a short app weighs less", () => {
    const t = verfuegbarkeitsTabelle(
      [
        { id: "a", monate: [monat(11, 9000, 0)] },
        { id: "b", monate: [monat(11, 1000, 10)] },
      ],
      1,
      JETZT,
    );
    expect(t.gesamt).toEqual([{ anteil: 0.999, unterZiel: false }]);
    expect(t.zeilen[1]?.zellen).toEqual([{ anteil: 0.99, unterZiel: true }]);
  });
});

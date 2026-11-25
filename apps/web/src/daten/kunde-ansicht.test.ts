import { describe, expect, it } from "vitest";
import type { AppZeile, Stufe } from "./apps-liste.ts";
import { kundeStand } from "./kunde-ansicht.ts";

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

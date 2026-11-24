import type { EinstellungsFeld } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { installationenJeApp, werteGesetzt } from "./app-werte.ts";

// The line beside the app switch of "Werte für Apps" (docs/einstellungen.md): how many
// installations the values apply to, and how many of the app's values are set

const feld = (name: string, geheim = false): EinstellungsFeld => ({
  name,
  typ: geheim ? "geheim" : "text",
  pflicht: false,
  vorgabe: undefined,
  titel: name,
  beschreibung: undefined,
  geheim,
  option: undefined,
});

describe("the values set of an app", () => {
  it("count a value shown and a secret named as set; an empty text is none", () => {
    expect(
      werteGesetzt({
        felder: [feld("A"), feld("B"), feld("C"), feld("D", true), feld("E", true)],
        werte: { A: "1", B: "", C: false },
        gesetzt: ["D"],
      }),
    ).toEqual({ gesetzt: 3, gesamt: 5 });
  });

  it("are none of none for an app without fields", () => {
    expect(werteGesetzt({ felder: [], werte: {}, gesetzt: [] })).toEqual({
      gesetzt: 0,
      gesamt: 0,
    });
  });
});

describe("the installations of each app", () => {
  it("count every installation that is not removed", () => {
    const zaehlung = installationenJeApp([
      { app: "haben", zustand: "laeuft" },
      { app: "haben", zustand: "gescheitert" },
      { app: "haben", zustand: "entfernt" },
      { app: "kontext", zustand: "wird_eingerichtet" },
    ]);
    expect(zaehlung.get("haben")).toBe(2);
    expect(zaehlung.get("kontext")).toBe(1);
    expect(zaehlung.get("belegt") ?? 0).toBe(0);
  });
});

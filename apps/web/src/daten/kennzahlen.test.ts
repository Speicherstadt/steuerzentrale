import { describe, expect, it } from "vitest";
import { berlin } from "../format/zeit.ts";
import type { InstallationsAngebot } from "./apps.ts";
import { backupsDerNacht, laufendeWelle } from "./kennzahlen.ts";

/*
 * Two tiles of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): the update wave that
 * runs, or what could be updated, and last night's backups with the failures named.
 */

const angebot = (
  installationId: string,
  app: string,
  version: string,
  angaben: Partial<InstallationsAngebot> = {},
): InstallationsAngebot => ({
  installationId,
  kundeId: "k",
  app,
  version,
  intern: false,
  angeboten: [],
  plan: null,
  update: { letzter: null, laeuft: false },
  ...angaben,
});

const NEU = [{ version: "0.0.7", dringend: false, vorabversion: false }];
const geplant = (version: string) => ({
  welle: "alle" as const,
  version,
  art: "termin" as const,
  ab: 0,
  sperrzeitUebergangen: false,
});

describe("laufendeWelle", () => {
  it("counts the installations of the app on the wave's version among those it covers", () => {
    const w = laufendeWelle([
      angebot("intern-belegt", "belegt", "0.0.7"),
      angebot("atelier-belegt", "belegt", "0.0.6", {
        angeboten: NEU,
        plan: geplant("0.0.7"),
        update: { letzter: null, laeuft: true },
      }),
      angebot("holm-belegt", "belegt", "0.0.6", { angeboten: NEU, plan: geplant("0.0.7") }),
      angebot("roth-haben", "haben", "0.11.0", {
        angeboten: [{ version: "0.12.0", dringend: false, vorabversion: false }],
      }),
      angebot("weber-haben", "haben", "0.12.0"),
    ]);
    expect(w).toEqual({
      welle: { app: "belegt", version: "0.0.7", fertig: 1, gesamt: 3 },
      moeglich: 1,
    });
  });

  it("has no wave when no plan holds an installation, only what could be updated", () => {
    expect(
      laufendeWelle([
        angebot("a", "haben", "0.11.0", { angeboten: NEU }),
        angebot("b", "haben", "0.12.0"),
      ]),
    ).toEqual({ welle: null, moeglich: 1 });
  });
});

describe("backupsDerNacht", () => {
  const SEIT = berlin("2026-11-19", "18:00");
  const zeile = (
    app: string,
    kundeName: string,
    letzter: { zeitpunkt: number; ok: boolean } | null,
    pruef: boolean | null = null,
  ) => ({
    app,
    kundeName,
    teile: [{ art: "volume" as const, name: "daten" }],
    letzter,
    pruefRestore: { letzter: pruef === null ? null : { zeitpunkt: SEIT, ok: pruef } },
  });

  it("marks each app by its run since yesterday evening and names the failures", () => {
    const n = backupsDerNacht(
      [
        zeile("haben", "Holm", { zeitpunkt: SEIT + 1000, ok: true }, true),
        zeile("haben", "Studio Lind", { zeitpunkt: SEIT + 1000, ok: false }),
        zeile("belegt", "Holm", { zeitpunkt: SEIT - 1000, ok: true }, false),
        zeile("kontext", "Aust", null),
        { ...zeile("stellwerk", "Kraft", null), teile: [] },
      ],
      SEIT,
    );
    expect(n.teile.map((t) => t.ton)).toEqual(["ok", "danger", "warn", "leer"]);
    expect(n).toMatchObject({
      ok: 1,
      gesamt: 4,
      gescheitert: [{ app: "haben", kundeName: "Studio Lind" }],
      pruefGescheitert: 1,
    });
  });
});

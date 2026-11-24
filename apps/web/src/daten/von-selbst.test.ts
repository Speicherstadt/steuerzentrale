import { describe, expect, it } from "vitest";
import { berlin } from "../format/zeit.ts";
import { type ErledigtEingabe, vonSelbst } from "./von-selbst.ts";

/*
 * "Von selbst erledigt" of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): what the
 * Zentrale did since yesterday evening without anyone, counted from what the API returns.
 */

const SEIT = berlin("2026-11-19", "18:00");
const DAVOR = SEIT - 60_000;
const DANACH = SEIT + 60_000;

const backup = (
  zeitpunkt: number | null,
  ok: boolean,
  pruef?: { zeitpunkt: number; ok: boolean },
) => ({
  letzter: zeitpunkt === null ? null : { zeitpunkt, ok },
  pruefRestore: { letzter: pruef ?? null },
});

const update = (installationId: string, endeAm: number | null, phase = "aktualisiert") => ({
  installationId,
  update: {
    letzter: {
      vonVersion: "0.0.6",
      nachVersion: "0.0.7",
      anlass: "welle" as const,
      welle: "intern",
      sperrzeitUebergangen: false,
      angefordertAm: (endeAm ?? DANACH) - 600_000,
      phase: phase as "aktualisiert",
      endeAm,
      fehler: null,
      dauerMs: 600_000,
    },
    laeuft: false,
  },
});

const LEER: ErledigtEingabe = { backups: [], angebote: [], server: [], installationen: [] };

describe("vonSelbst", () => {
  it("counts the backups and test restores that succeeded since yesterday evening", () => {
    const e = vonSelbst(
      {
        ...LEER,
        backups: [
          backup(DANACH, true, { zeitpunkt: DANACH, ok: true }),
          backup(DANACH, true, { zeitpunkt: DANACH, ok: false }),
          backup(DANACH, false),
          backup(DAVOR, true, { zeitpunkt: DAVOR, ok: true }),
          backup(null, false),
        ],
      },
      SEIT,
    );
    expect(e.backups).toBe(2);
    expect(e.pruefRestores).toBe(1);
  });

  it("names the updates applied, one line per app version with its customers", () => {
    const e = vonSelbst(
      {
        ...LEER,
        installationen: [
          { id: "intern-belegt", appName: "Belegt", kundeName: "Beispiel-Hosting" },
          { id: "atelier-belegt", appName: "Belegt", kundeName: "Atelier Nord" },
          { id: "roth-belegt", appName: "Belegt", kundeName: "Roth" },
          { id: "aust-belegt", appName: "Belegt", kundeName: "Aust" },
        ],
        angebote: [
          update("intern-belegt", DANACH),
          update("atelier-belegt", DANACH),
          update("roth-belegt", DAVOR),
          update("aust-belegt", DANACH, "zurueckgenommen"),
        ],
      },
      SEIT,
    );
    expect(e.updates).toEqual([
      { appName: "Belegt", version: "0.0.7", kunden: ["Beispiel-Hosting", "Atelier Nord"] },
    ]);
  });

  it("counts reboots the plan made and the servers unattended-upgrades ran on", () => {
    const neustart = (zustand: string, vonHand: boolean, geaendertAm: number) => ({
      noetig: false,
      plan: { art: "warten" as const, grund: "nicht_noetig" as const },
      letzter: {
        auftragId: "A",
        zustand,
        vonHand,
        angelegtAm: geaendertAm,
        geaendertAm,
        fehler: null,
      },
    });
    const lauf = (letzterLauf: number | null) => ({ installiert: true, aktiv: true, letzterLauf });
    const e = vonSelbst(
      {
        ...LEER,
        server: [
          { neustartStand: neustart("erfolgreich", false, DANACH), unattended: lauf(DANACH) },
          { neustartStand: neustart("erfolgreich", true, DANACH), unattended: lauf(DAVOR) },
          { neustartStand: neustart("gescheitert", false, DANACH), unattended: lauf(null) },
          { neustartStand: neustart("erfolgreich", false, DAVOR), unattended: null },
        ],
      },
      SEIT,
    );
    expect(e.neustarts).toBe(1);
    expect(e.sicherheitsupdates).toBe(1);
  });

  it("is empty when nothing happened", () => {
    expect(vonSelbst(LEER, SEIT)).toEqual({
      backups: 0,
      pruefRestores: 0,
      updates: [],
      neustarts: 0,
      sicherheitsupdates: 0,
    });
  });
});

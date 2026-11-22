import { describe, expect, it } from "vitest";
import {
  type Bewertungsstand,
  bewertungFortschreiben,
  bewertungJetzt,
  GRUND_MAX,
  installationBewerten,
  MELDUNG_FRIST_MS,
  type Meldung,
  STOERUNG_NACH_MS,
  stoerungPruefen,
} from "./bewertung.ts";

/*
 * docs/plan.md, "Bewertung einer Installation" and "Störung": red when health is red, yellow when a
 * unit is not active, green only when measured, unknown otherwise or without a report for 90 s;
 * a fault after five minutes of red, fixed once green again.
 */

const gruen = { zustand: "gruen" as const, grund: "HTTP 200 in 21 ms" };
const melde = (teil: Partial<Meldung> = {}): Meldung => ({
  units: [
    { name: "probe-app.service", aktiv: "active" },
    { name: "probe-db.service", aktiv: "active" },
  ],
  health: gruen,
  ...teil,
});

describe("installationBewerten", () => {
  it("is green when every unit is active and the check is green", () => {
    expect(installationBewerten(melde(), true)).toEqual({
      bewertung: "gruen",
      grund: { code: "health", werte: { text: "HTTP 200 in 21 ms" } },
    });
  });

  it("is red when the check is red, whatever the units say", () => {
    const rot = { zustand: "rot" as const, grund: "HTTP 503" };
    expect(
      installationBewerten(
        melde({ health: rot, units: [{ name: "probe-app.service", aktiv: "failed" }] }),
        true,
      ),
    ).toEqual({ bewertung: "rot", grund: { code: "health", werte: { text: "HTTP 503" } } });
  });

  it("is yellow with the first unit that is not active, naming it and its ActiveState", () => {
    const units = [
      { name: "probe-app.service", aktiv: "active" as const },
      { name: "probe-worker.service", aktiv: "failed" as const },
      { name: "probe-db.service", aktiv: "inactive" as const },
    ];
    expect(installationBewerten(melde({ units }), true)).toEqual({
      bewertung: "gelb",
      grund: { code: "unit", werte: { unit: "probe-worker.service", aktiv: "failed" } },
    });
  });

  it("counts an activating or reloading unit as not active", () => {
    for (const aktiv of ["activating", "reloading", "deactivating", "maintenance"] as const)
      expect(
        installationBewerten(melde({ units: [{ name: "a.service", aktiv }] }), true).bewertung,
      ).toBe("gelb");
  });

  it("is unknown for a unit the agent could not read, unless another one is known not active", () => {
    const unbekannt = { name: "probe-app.service", aktiv: "unknown" as const };
    expect(installationBewerten(melde({ units: [unbekannt] }), true)).toEqual({
      bewertung: "unbekannt",
      grund: { code: "unit", werte: { unit: "probe-app.service", aktiv: "unknown" } },
    });
    const beendet = { name: "probe-db.service", aktiv: "failed" as const };
    expect(installationBewerten(melde({ units: [unbekannt, beendet] }), true).bewertung).toBe(
      "gelb",
    );
  });

  it("is never green without units: nothing was measured", () => {
    expect(installationBewerten(melde({ units: [] }), true)).toEqual({
      bewertung: "unbekannt",
      grund: { code: "keine_units", werte: {} },
    });
    expect(installationBewerten(melde({ units: [] }), false).bewertung).toBe("unbekannt");
  });

  it("rates an app without a health check (`keine`) by its units alone", () => {
    const ohne = { zustand: "unbekannt" as const, grund: "keine Prüfung" };
    expect(installationBewerten(melde({ health: ohne }), false)).toEqual({
      bewertung: "gruen",
      grund: { code: "nur_units", werte: {} },
    });
    const units = [{ name: "a.service", aktiv: "failed" as const }];
    expect(installationBewerten(melde({ health: ohne, units }), false).bewertung).toBe("gelb");
  });

  it("is unknown when the check could not say, for an app that has one", () => {
    const ohne = { zustand: "unbekannt" as const, grund: "Zeitlimit überschritten" };
    expect(installationBewerten(melde({ health: ohne }), true)).toEqual({
      bewertung: "unbekannt",
      grund: { code: "health", werte: { text: "Zeitlimit überschritten" } },
    });
  });

  it("is yellow when the check itself warns", () => {
    const gelb = { zustand: "gelb" as const, grund: "langsam: 4 s" };
    expect(installationBewerten(melde({ health: gelb }), true)).toEqual({
      bewertung: "gelb",
      grund: { code: "health", werte: { text: "langsam: 4 s" } },
    });
  });

  it("keeps the agent's reason short", () => {
    const lang = { zustand: "rot" as const, grund: "x".repeat(GRUND_MAX + 50) };
    expect(installationBewerten(melde({ health: lang }), true).grund.werte.text).toHaveLength(
      GRUND_MAX,
    );
  });
});

const T = Date.UTC(2026, 10, 22, 12);
const stand = (teil: Partial<Bewertungsstand> = {}): Bewertungsstand => ({
  bewertung: "gruen",
  grund: { code: "health", werte: { text: "ok" } },
  seit: T,
  gemeldetAm: T,
  ...teil,
});

describe("bewertungFortschreiben", () => {
  const rot = {
    bewertung: "rot" as const,
    grund: { code: "health" as const, werte: { text: "503" } },
  };

  it("starts a first rating at its report", () => {
    expect(bewertungFortschreiben(null, rot, T)).toEqual({
      stand: { ...rot, seit: T, gemeldetAm: T },
      wechsel: true,
    });
  });

  it("keeps `seit` while the rating stays, with the newest reason", () => {
    const neu = { bewertung: "gruen" as const, grund: { code: "nur_units" as const, werte: {} } };
    expect(bewertungFortschreiben(stand(), neu, T + 30_000)).toEqual({
      stand: { ...neu, seit: T, gemeldetAm: T + 30_000 },
      wechsel: false,
    });
  });

  it("starts a new `seit` with every change of the rating", () => {
    expect(bewertungFortschreiben(stand(), rot, T + 30_000)).toEqual({
      stand: { ...rot, seit: T + 30_000, gemeldetAm: T + 30_000 },
      wechsel: true,
    });
  });
});

describe("bewertungJetzt", () => {
  it("is unknown without any report", () => {
    expect(bewertungJetzt(null, T)).toEqual({
      bewertung: "unbekannt",
      grund: { code: "noch_keine_meldung", werte: {} },
      seit: null,
      gemeldetAm: null,
    });
  });

  it("keeps the rating up to 90 s after the last report and is unknown from then on, never green", () => {
    expect(bewertungJetzt(stand(), T + MELDUNG_FRIST_MS - 1)).toEqual(stand());
    expect(bewertungJetzt(stand(), T + MELDUNG_FRIST_MS)).toEqual({
      bewertung: "unbekannt",
      grund: { code: "keine_meldung", werte: {} },
      seit: T + MELDUNG_FRIST_MS,
      gemeldetAm: T,
    });
  });

  it("leaves an unknown rating as it is", () => {
    const unbekannt = stand({ bewertung: "unbekannt", grund: { code: "keine_units", werte: {} } });
    expect(bewertungJetzt(unbekannt, T + 10 * MELDUNG_FRIST_MS)).toEqual(unbekannt);
  });
});

describe("stoerungPruefen", () => {
  const rot = stand({ bewertung: "rot", gemeldetAm: T + STOERUNG_NACH_MS });

  it("is a fault after five minutes of red, not at 4:59", () => {
    expect(stoerungPruefen(rot, false, T + STOERUNG_NACH_MS - 1_000)).toBeUndefined();
    expect(stoerungPruefen(rot, false, T + STOERUNG_NACH_MS)).toBe("stoerung");
  });

  it("is a fault once per phase: not again while one is open", () => {
    expect(stoerungPruefen(rot, true, T + 60 * 60_000)).toBeUndefined();
  });

  it("is fixed when green after a fault, and only then", () => {
    expect(stoerungPruefen(stand(), true, T)).toBe("behoben");
    expect(stoerungPruefen(stand(), false, T)).toBeUndefined();
  });

  it("is not fixed by unknown or yellow", () => {
    expect(stoerungPruefen(stand({ bewertung: "unbekannt" }), true, T)).toBeUndefined();
    expect(stoerungPruefen(stand({ bewertung: "gelb" }), true, T)).toBeUndefined();
  });

  it("counts red only while reports come: red without one for 90 s is unknown", () => {
    const still = stand({ bewertung: "rot", gemeldetAm: T + 60_000 });
    expect(stoerungPruefen(still, false, T + STOERUNG_NACH_MS)).toBeUndefined();
  });
});

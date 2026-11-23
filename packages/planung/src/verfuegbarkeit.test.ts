import { describe, expect, it } from "vitest";
import {
  imMonat,
  inScheiben,
  letzteMonate,
  monatsGrenzen,
  monatVon,
  type Pruefergebnis,
  scheibeFortschreiben,
  verfuegbarkeitImMonat,
} from "./verfuegbarkeit.ts";
import { instantVon } from "./zeit.ts";

/*
 * BAULISTE.md Z-704: the availability of an installation per month, from the checks from outside,
 * one a minute; a month is a calendar month in Europe/Berlin (docs/plan.md, "Verfügbarkeit"). The
 * test series checks every minute of a month and has outages whose length is known, also across
 * the end of the month and on the night the clocks change.
 */

const MIN = 60_000;

/** One check a minute from `von` to before `bis`, red inside any of the outages */
const reihe = (von: number, bis: number, ausfaelle: [number, number][]): Pruefergebnis[] => {
  const ergebnisse: Pruefergebnis[] = [];
  for (let t = von; t < bis; t += MIN) {
    const rot = ausfaelle.some(([a, b]) => t >= a && t < b);
    ergebnisse.push({ zeitpunkt: t, zustand: rot ? "rot" : "gruen" });
  }
  return ergebnisse;
};

describe("months in Europe/Berlin", () => {
  it("begin at local midnight: 23:00 UTC in winter, 22:00 UTC in summer", () => {
    expect(monatsGrenzen({ jahr: 2026, monat: 11 })).toEqual({
      von: Date.UTC(2026, 9, 31, 23),
      bis: Date.UTC(2026, 10, 30, 23),
    });
    expect(monatsGrenzen({ jahr: 2026, monat: 7 })).toEqual({
      von: Date.UTC(2026, 5, 30, 22),
      bis: Date.UTC(2026, 6, 31, 22),
    });
  });

  it("have 743 hours in March and 745 in October, when the clocks change", () => {
    const stunden = (monat: number) => {
      const g = monatsGrenzen({ jahr: 2026, monat });
      return (g.bis - g.von) / (60 * MIN);
    };
    expect(stunden(3)).toBe(743);
    expect(stunden(10)).toBe(745);
    expect(stunden(11)).toBe(720);
  });

  it("roll over the year", () => {
    expect(monatsGrenzen({ jahr: 2026, monat: 12 }).bis).toBe(Date.UTC(2026, 11, 31, 23));
    expect(monatVon(Date.UTC(2026, 11, 31, 23))).toEqual({ jahr: 2027, monat: 1 });
    expect(monatVon(Date.UTC(2026, 11, 31, 22, 59))).toEqual({ jahr: 2026, monat: 12 });
  });

  it("are counted back from now, the current one first", () => {
    expect(letzteMonate(Date.UTC(2026, 1, 10), 3)).toEqual([
      { jahr: 2026, monat: 2 },
      { jahr: 2026, monat: 1 },
      { jahr: 2025, monat: 12 },
    ]);
  });
});

describe("slices per hour", () => {
  it("count the checks and the red ones of each UTC hour", () => {
    const t = Date.UTC(2026, 10, 2, 10);
    const scheiben = inScheiben([
      { zeitpunkt: t, zustand: "gruen" },
      { zeitpunkt: t + 59 * MIN, zustand: "rot" },
      { zeitpunkt: t + 60 * MIN, zustand: "rot" },
    ]);
    expect(scheiben).toEqual([
      { stunde: t, gemessen: 2, rot: 1 },
      { stunde: t + 60 * MIN, gemessen: 1, rot: 1 },
    ]);
  });

  it("are added up one check at a time as the Zentrale stores them", () => {
    const t = Date.UTC(2026, 10, 2, 10, 30);
    expect(scheibeFortschreiben(undefined, t, "rot")).toEqual({
      stunde: Date.UTC(2026, 10, 2, 10),
      gemessen: 1,
      rot: 1,
    });
    expect(
      scheibeFortschreiben({ stunde: Date.UTC(2026, 10, 2, 10), gemessen: 4, rot: 1 }, t, "gruen"),
    ).toEqual({ stunde: Date.UTC(2026, 10, 2, 10), gemessen: 5, rot: 1 });
  });

  it("each lie within one month, as Berlin is a whole number of hours from UTC", () => {
    for (const monat of [1, 3, 4, 10, 11]) {
      const g = monatsGrenzen({ jahr: 2026, monat });
      expect(g.von % (60 * MIN)).toBe(0);
      expect(imMonat(g.von - 60 * MIN, g)).toBe(false);
      expect(imMonat(g.von, g)).toBe(true);
      expect(imMonat(g.bis - 60 * MIN, g)).toBe(true);
      expect(imMonat(g.bis, g)).toBe(false);
    }
  });
});

describe("verfuegbarkeitImMonat", () => {
  it("is the share of green checks, from a series with known outages", () => {
    const g = monatsGrenzen({ jahr: 2026, monat: 11 });
    // 43 200 minutes; outages of 30, 12 and 1 minutes
    const ausfaelle: [number, number][] = [
      [Date.UTC(2026, 10, 3, 9, 15), Date.UTC(2026, 10, 3, 9, 45)],
      [Date.UTC(2026, 10, 17, 23, 50), Date.UTC(2026, 10, 18, 0, 2)],
      [Date.UTC(2026, 10, 28, 4), Date.UTC(2026, 10, 28, 4, 1)],
    ];
    const scheiben = inScheiben(reihe(g.von, g.bis, ausfaelle));
    expect(verfuegbarkeitImMonat(scheiben, { jahr: 2026, monat: 11 }, g.bis)).toEqual({
      jahr: 2026,
      monat: 11,
      minuten: 43_200,
      gemessen: 43_200,
      rot: 43,
      anteil: (43_200 - 43) / 43_200,
    });
  });

  it("splits an outage across the end of the month at local midnight", () => {
    // 31 October 23:30 to 1 November 00:30 in Berlin (winter time, UTC+1)
    const ausfall: [number, number] = [
      instantVon(2026, 10, 31, 23, 30),
      instantVon(2026, 11, 1, 0, 30),
    ];
    const von = monatsGrenzen({ jahr: 2026, monat: 10 }).von;
    const bis = monatsGrenzen({ jahr: 2026, monat: 11 }).bis;
    const scheiben = inScheiben(reihe(von, bis, [ausfall]));
    const oktober = verfuegbarkeitImMonat(scheiben, { jahr: 2026, monat: 10 }, bis);
    const november = verfuegbarkeitImMonat(scheiben, { jahr: 2026, monat: 11 }, bis);
    expect([oktober.minuten, oktober.gemessen, oktober.rot]).toEqual([44_700, 44_700, 30]);
    expect([november.minuten, november.gemessen, november.rot]).toEqual([43_200, 43_200, 30]);
  });

  it("counts the night the clocks go back as 25 hours, the night they go forward as 23", () => {
    // 25 October 2026: 02:00–03:00 happens twice; an outage from 01:30 to 03:30 local time
    // (first occurrence of 01:30, after the second 03:00) lasts three hours
    const herbst: [number, number] = [Date.UTC(2026, 9, 24, 23, 30), Date.UTC(2026, 9, 25, 2, 30)];
    // 29 March 2026: 02:00–03:00 does not exist; 01:30 to 03:30 local lasts one hour
    const fruehling: [number, number] = [
      instantVon(2026, 3, 29, 1, 30),
      instantVon(2026, 3, 29, 3, 30),
    ];
    expect(fruehling[1] - fruehling[0]).toBe(60 * MIN);
    const oktober = monatsGrenzen({ jahr: 2026, monat: 10 });
    const maerz = monatsGrenzen({ jahr: 2026, monat: 3 });
    const o = verfuegbarkeitImMonat(
      inScheiben(reihe(oktober.von, oktober.bis, [herbst])),
      { jahr: 2026, monat: 10 },
      oktober.bis,
    );
    const m = verfuegbarkeitImMonat(
      inScheiben(reihe(maerz.von, maerz.bis, [fruehling])),
      { jahr: 2026, monat: 3 },
      maerz.bis,
    );
    expect([o.minuten, o.rot, o.anteil]).toEqual([44_700, 180, (44_700 - 180) / 44_700]);
    expect([m.minuten, m.rot, m.anteil]).toEqual([44_580, 60, (44_580 - 60) / 44_580]);
  });

  it("leaves minutes without a check out of the share and says how many were measured", () => {
    const g = monatsGrenzen({ jahr: 2026, monat: 11 });
    // the Zentrale was down for the first day; one red hour after it
    const tag = g.von + 24 * 60 * MIN;
    const scheiben = inScheiben(reihe(tag, g.bis, [[tag, tag + 60 * MIN]]));
    const v = verfuegbarkeitImMonat(scheiben, { jahr: 2026, monat: 11 }, g.bis);
    expect(v).toMatchObject({ minuten: 43_200, gemessen: 43_200 - 1440, rot: 60 });
    expect(v.anteil).toBe((41_760 - 60) / 41_760);
  });

  it("counts the current month up to now, and has no share without any check", () => {
    const g = monatsGrenzen({ jahr: 2026, monat: 11 });
    const jetzt = g.von + 90 * MIN;
    const scheiben = inScheiben(reihe(g.von, jetzt, [[g.von + 10 * MIN, g.von + 20 * MIN]]));
    expect(verfuegbarkeitImMonat(scheiben, { jahr: 2026, monat: 11 }, jetzt)).toEqual({
      jahr: 2026,
      monat: 11,
      minuten: 90,
      gemessen: 90,
      rot: 10,
      anteil: 80 / 90,
    });
    expect(verfuegbarkeitImMonat([], { jahr: 2026, monat: 12 }, jetzt)).toEqual({
      jahr: 2026,
      monat: 12,
      minuten: 0,
      gemessen: 0,
      rot: 0,
      anteil: null,
    });
  });
});

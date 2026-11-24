import { describe, expect, it } from "vitest";
import { gesternAbend, sperrzeitBeginne, VORSCHAU_TAGE } from "./vorschau.ts";
import { instantVon } from "./zeit.ts";

/*
 * The overview's look ahead and back (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): freeze
 * windows that begin within the next days, and "since yesterday evening", both in Berlin days.
 */

const berlin = (j: number, m: number, t: number, h = 12, min = 0) => instantVon(j, m, t, h, min);
const HABEN = [{ monatlich: "07-12", grund: "Umsatzsteuer-Voranmeldung" }];
const MONATSWECHSEL = [{ monatlich: "28-03", grund: "Monatsabschluss" }];
const WOCHE = VORSCHAU_TAGE * 86_400_000;

describe("sperrzeitBeginne", () => {
  it("gives a freeze window that begins within the next seven days, with its last day", () => {
    const jetzt = berlin(2026, 12, 2, 10, 42);
    expect(sperrzeitBeginne(HABEN, jetzt, jetzt + WOCHE)).toEqual([
      {
        grund: "Umsatzsteuer-Voranmeldung",
        beginn: berlin(2026, 12, 7, 0, 0),
        ende: berlin(2026, 12, 13, 0, 0),
      },
    ]);
  });

  it("leaves out one that began already or begins later", () => {
    expect(sperrzeitBeginne(HABEN, berlin(2026, 12, 8), berlin(2026, 12, 8) + WOCHE)).toEqual([]);
    expect(sperrzeitBeginne(HABEN, berlin(2026, 11, 20), berlin(2026, 11, 20) + WOCHE)).toEqual([]);
  });

  it("ends one that crosses the month's end in the next month", () => {
    const jetzt = berlin(2027, 1, 25);
    expect(sperrzeitBeginne(MONATSWECHSEL, jetzt, jetzt + WOCHE)).toEqual([
      {
        grund: "Monatsabschluss",
        beginn: berlin(2027, 1, 28, 0, 0),
        ende: berlin(2027, 2, 4, 0, 0),
      },
    ]);
  });

  it("begins at midnight in Berlin also on the day the clocks change", () => {
    const umstellung = [{ monatlich: "29-30", grund: "Abschluss" }];
    // 29 March 2026: the clocks go forward at 02:00; midnight is still 23:00 UTC the day before
    const jetzt = berlin(2026, 3, 26);
    expect(sperrzeitBeginne(umstellung, jetzt, jetzt + WOCHE)[0]?.beginn).toBe(
      Date.parse("2026-03-28T23:00:00Z"),
    );
    // 25 October 2026: back at 03:00; the window ends at midnight CET, 23:00 UTC
    const herbst = [{ monatlich: "25-25", grund: "Abschluss" }];
    const oktober = berlin(2026, 10, 22);
    expect(sperrzeitBeginne(herbst, oktober, oktober + WOCHE)).toEqual([
      {
        grund: "Abschluss",
        beginn: Date.parse("2026-10-24T22:00:00Z"),
        ende: Date.parse("2026-10-25T23:00:00Z"),
      },
    ]);
  });
});

describe("gesternAbend", () => {
  it("is 18:00 in Berlin on the day before", () => {
    expect(gesternAbend(berlin(2026, 11, 20, 10, 42))).toBe(berlin(2026, 11, 19, 18, 0));
    expect(gesternAbend(berlin(2026, 11, 20, 0, 5))).toBe(berlin(2026, 11, 19, 18, 0));
  });

  it("keeps 18:00 across a change of the clocks", () => {
    // 24 October is still summer time (16:00 UTC), 25 October winter time (17:00 UTC)
    expect(gesternAbend(berlin(2026, 10, 25, 9))).toBe(Date.parse("2026-10-24T16:00:00Z"));
    expect(gesternAbend(berlin(2026, 10, 26, 9))).toBe(Date.parse("2026-10-25T17:00:00Z"));
  });
});

import { describe, expect, it } from "vitest";
import { nachSperrzeit, naechsterTermin, sperrzeitAm } from "./fenster.ts";
import { instantVon, ortszeit } from "./zeit.ts";

const berlin = (j: number, m: number, t: number, h = 12, min = 0) => instantVon(j, m, t, h, min);
const HABEN = [{ monatlich: "07-12", grund: "Umsatzsteuer-Voranmeldung" }];
const MONATSWECHSEL = [{ monatlich: "28-03", grund: "Monatsabschluss" }];
const NACHTS = [{ tage: [0, 1, 2, 3, 4, 5, 6], von: "02:00", bis: "04:00" }];

describe("freeze windows", () => {
  it("cover the 7th to the 12th, inclusive, in Berlin days", () => {
    expect(sperrzeitAm(HABEN, berlin(2026, 11, 6, 23, 59))).toBeUndefined();
    expect(sperrzeitAm(HABEN, berlin(2026, 11, 7, 0, 0))).toBeDefined();
    expect(sperrzeitAm(HABEN, berlin(2026, 11, 12, 23, 59))).toBeDefined();
    expect(sperrzeitAm(HABEN, berlin(2026, 11, 13, 0, 0))).toBeUndefined();
  });

  it("count the Berlin day, not the UTC day", () => {
    // 23:30 UTC on the 6th is 00:30 on the 7th in Berlin
    expect(sperrzeitAm(HABEN, Date.parse("2026-11-06T23:30:00Z"))).toBeDefined();
  });

  it("cross the month's end when the last day comes before the first", () => {
    for (const [m, t] of [
      [1, 28],
      [1, 31],
      [2, 1],
      [2, 3],
      [2, 28],
      [3, 1],
    ] as const)
      expect(sperrzeitAm(MONATSWECHSEL, berlin(2026, m, t)), `${t}.${m}.`).toBeDefined();
    expect(sperrzeitAm(MONATSWECHSEL, berlin(2026, 2, 4))).toBeUndefined();
    expect(sperrzeitAm(MONATSWECHSEL, berlin(2026, 2, 27))).toBeUndefined();
  });

  it("end at midnight in Berlin after their last day, also across the month's end", () => {
    expect(nachSperrzeit(HABEN, berlin(2026, 11, 9))).toBe(berlin(2026, 11, 13, 0, 0));
    expect(nachSperrzeit(MONATSWECHSEL, berlin(2026, 1, 30))).toBe(berlin(2026, 2, 4, 0, 0));
    expect(nachSperrzeit(HABEN, berlin(2026, 11, 20))).toBe(berlin(2026, 11, 20));
  });
});

describe("maintenance windows", () => {
  it("give the start of the next window", () => {
    expect(naechsterTermin(NACHTS, [], berlin(2026, 11, 20, 12))).toBe(berlin(2026, 11, 21, 2, 0));
  });

  it("give the instant itself inside an open window", () => {
    expect(naechsterTermin(NACHTS, [], berlin(2026, 11, 20, 3, 0))).toBe(
      berlin(2026, 11, 20, 3, 0),
    );
  });

  it("run over midnight into the next day", () => {
    const spaet = [{ tage: [6], von: "23:00", bis: "03:00" }];
    // Saturday 21.11. 23:00 to Sunday 01:00
    expect(naechsterTermin(spaet, [], berlin(2026, 11, 20, 12))).toBe(berlin(2026, 11, 21, 23, 0));
    expect(naechsterTermin(spaet, [], berlin(2026, 11, 22, 1, 30))).toBe(
      berlin(2026, 11, 22, 1, 30),
    );
    expect(naechsterTermin(spaet, [], berlin(2026, 11, 22, 3, 0))).toBe(
      berlin(2026, 11, 28, 23, 0),
    );
  });

  it("start after midnight when a freeze window begins inside a window over midnight", () => {
    const spaet = [{ tage: [0, 1, 2, 3, 4, 5, 6], von: "23:00", bis: "03:00" }];
    const vor = [{ monatlich: "06-06", grund: "x" }];
    // 6.11. is frozen: the window of the 5th starts at 23:00 on the 5th, outside the freeze window
    expect(naechsterTermin(spaet, vor, berlin(2026, 11, 5, 12))).toBe(berlin(2026, 11, 5, 23, 0));
    // From the 6th at noon: the window of the 6th is frozen until midnight, then the 7th is free
    expect(naechsterTermin(spaet, vor, berlin(2026, 11, 6, 12))).toBe(berlin(2026, 11, 7, 0, 0));
  });

  it("skip a window that does not exist on the day the clocks go forward", () => {
    const sonntags = [{ tage: [0], von: "02:00", bis: "03:00" }];
    // 29.03.2026: 02:00 to 03:00 does not exist, the next Sunday has it
    expect(naechsterTermin(sonntags, [], berlin(2026, 3, 28, 12))).toBe(berlin(2026, 4, 5, 2, 0));
  });

  it("keep their wall time across the change to summer time", () => {
    const termin = naechsterTermin(NACHTS, [], berlin(2026, 3, 29, 12)) ?? 0;
    expect(termin).toBe(Date.parse("2026-03-30T00:00:00Z"));
    expect(ortszeit(termin)).toMatchObject({ stunde: 2, minute: 0 });
  });

  it("start at the first 02:00 when the clocks go back", () => {
    expect(naechsterTermin(NACHTS, [], berlin(2026, 10, 24, 12))).toBe(
      Date.parse("2026-10-25T00:00:00Z"),
    );
  });

  it("skip the days of a freeze window", () => {
    expect(naechsterTermin(NACHTS, HABEN, berlin(2026, 11, 6, 12))).toBe(
      berlin(2026, 11, 13, 2, 0),
    );
  });

  it("give no slot when there is none", () => {
    expect(naechsterTermin([], [], berlin(2026, 11, 6))).toBeUndefined();
    const immer = [{ monatlich: "01-31", grund: "x" }];
    expect(naechsterTermin(NACHTS, immer, berlin(2026, 11, 6))).toBeUndefined();
    expect(nachSperrzeit(immer, berlin(2026, 11, 6))).toBeUndefined();
  });
});

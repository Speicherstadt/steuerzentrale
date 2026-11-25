import { setLocale } from "@steuerzentrale/ui";
import { beforeEach, describe, expect, it } from "vitest";
import { berlin, datum, isoTag, monatName, tageSpaeter, uhrzeit, vor, zeitpunkt } from "./zeit.ts";

const jetzt = berlin("2026-11-20", "10:42");

describe("times in Europe/Berlin", () => {
  beforeEach(() => setLocale("de", { reload: false }));

  it("writes dates as TT.MM.JJJJ and times as HH:MM", () => {
    expect(datum(Date.UTC(2027, 1, 28, 12))).toBe("28.02.2027");
    expect(uhrzeit(Date.UTC(2026, 10, 20, 9, 36))).toBe("10:36");
  });

  it("follows daylight saving time", () => {
    // 25.10.2026: 03:00 CEST becomes 02:00 CET
    expect(uhrzeit(Date.UTC(2026, 9, 25, 0, 30))).toBe("02:30");
    expect(uhrzeit(Date.UTC(2026, 9, 25, 1, 30))).toBe("02:30");
    expect(uhrzeit(Date.UTC(2026, 6, 1, 10, 0))).toBe("12:00");
  });

  it("shows today's time alone, and yesterday and tomorrow by name", () => {
    expect(zeitpunkt(berlin("2026-11-20", "03:15"), jetzt)).toBe("03:15");
    expect(zeitpunkt(berlin("2026-11-19", "17:12"), jetzt)).toBe("gestern 17:12");
    expect(zeitpunkt(berlin("2026-11-21", "03:30"), jetzt)).toBe("morgen 03:30");
    expect(zeitpunkt(berlin("2026-11-18", "14:05"), jetzt)).toBe("18.11.2026 14:05");
  });

  it("counts calendar days in Berlin, not 24-hour spans", () => {
    // 00:10 Berlin on the 20th is 23:10 UTC on the 19th: still today
    expect(zeitpunkt(berlin("2026-11-20", "00:10"), jetzt)).toBe("00:10");
    expect(zeitpunkt(berlin("2026-11-19", "23:50"), jetzt)).toBe("gestern 23:50");
  });

  it("says coarsely how long ago", () => {
    expect(vor(jetzt - 12_000, jetzt)).toBe("vor 12 s");
    expect(vor(jetzt - 6 * 60_000, jetzt)).toBe("vor 6 Min.");
    expect(vor(jetzt - 3 * 3_600_000, jetzt)).toBe("vor 3 h");
    expect(vor(jetzt - 12 * 86_400_000, jetzt)).toBe("vor 12 Tg.");
  });

  it("speaks English when the interface does", () => {
    setLocale("en", { reload: false });
    expect(zeitpunkt(berlin("2026-11-19", "17:12"), jetzt)).toBe("yesterday 17:12");
    expect(vor(jetzt - 12_000, jetzt)).toBe("12 s ago");
    expect(datum(jetzt)).toBe("20.11.2026");
  });

  it("names a month", () => {
    expect(monatName("2026-11")).toBe("November 2026");
  });
});

// Contract dates (Z-801): a date field's day is the start of that day in Berlin, and back
describe("days of a date field", () => {
  it("are the start of the day in Berlin, in summer and winter", () => {
    expect(berlin("2026-11-30")).toBe(Date.UTC(2026, 10, 29, 23));
    expect(berlin("2026-07-01")).toBe(Date.UTC(2026, 5, 30, 22));
    expect(isoTag(berlin("2026-11-30"))).toBe("2026-11-30");
    expect(isoTag(Date.UTC(2026, 10, 29, 23, 30))).toBe("2026-11-30");
  });

  it("move by calendar days across a change of daylight saving time", () => {
    expect(datum(tageSpaeter(berlin("2026-11-30"), 90))).toBe("28.02.2027");
    // 29.03.2027: the night of 28.03. has 23 hours
    expect(isoTag(tageSpaeter(berlin("2027-03-27"), 2))).toBe("2027-03-29");
    expect(tageSpaeter(berlin("2027-03-27"), 2)).toBe(berlin("2027-03-29"));
  });
});

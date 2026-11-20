import { describe, expect, it } from "vitest";
import { instantVon, ortszeit, tagesbeginn } from "./zeit.ts";

const utc = (text: string) => Date.parse(text);

describe("Berlin wall time", () => {
  it("is UTC+1 in winter and UTC+2 in summer", () => {
    expect(instantVon(2026, 1, 15, 12, 0)).toBe(utc("2026-01-15T11:00:00Z"));
    expect(instantVon(2026, 7, 15, 12, 0)).toBe(utc("2026-07-15T10:00:00Z"));
  });

  it("moves a wall time in the skipped spring hour forward by the gap", () => {
    expect(instantVon(2026, 3, 29, 2, 30)).toBe(utc("2026-03-29T01:30:00Z"));
    expect(ortszeit(instantVon(2026, 3, 29, 2, 30))).toMatchObject({ stunde: 3, minute: 30 });
    expect(instantVon(2026, 3, 29, 3, 0)).toBe(utc("2026-03-29T01:00:00Z"));
  });

  it("takes the first of the two repeated autumn hours", () => {
    expect(instantVon(2026, 10, 25, 2, 30)).toBe(utc("2026-10-25T00:30:00Z"));
    expect(instantVon(2026, 10, 25, 3, 0)).toBe(utc("2026-10-25T02:00:00Z"));
  });

  it("rolls a day past the month's end into the next month", () => {
    expect(instantVon(2026, 2, 29, 0, 0)).toBe(instantVon(2026, 3, 1, 0, 0));
  });

  it("knows the weekday and the start of the day", () => {
    expect(ortszeit(utc("2026-11-22T23:30:00Z"))).toMatchObject({
      tag: 23,
      wochentag: 1,
      stunde: 0,
    });
    expect(tagesbeginn(utc("2026-03-29T12:00:00Z"), 1)).toBe(utc("2026-03-29T22:00:00Z"));
    expect(
      tagesbeginn(utc("2026-10-25T12:00:00Z"), 1) - tagesbeginn(utc("2026-10-25T12:00:00Z")),
    ).toBe(25 * 3600_000);
  });
});

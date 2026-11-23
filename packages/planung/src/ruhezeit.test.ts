import { describe, expect, it } from "vitest";
import { meldeSchwere, ruhezeitEnde, schwereReicht, zustellbarAb } from "./ruhezeit.ts";
import { instantVon } from "./zeit.ts";

/*
 * BAULISTE.md Z-703: quiet hours of an operator in Europe/Berlin hold every message but a fault
 * (`fehler`) until they end; over midnight and across the changes of daylight saving time.
 */
const berlin = (j: number, m: number, t: number, h = 12, min = 0) => instantVon(j, m, t, h, min);
const NACHT = { von: "22:00", bis: "07:00" };
const STUNDE = 3600_000;

describe("quiet hours", () => {
  it("run from von to before bis, over midnight", () => {
    expect(ruhezeitEnde(NACHT, berlin(2026, 11, 20, 21, 59))).toBeUndefined();
    expect(ruhezeitEnde(NACHT, berlin(2026, 11, 20, 22, 0))).toBe(berlin(2026, 11, 21, 7, 0));
    expect(ruhezeitEnde(NACHT, berlin(2026, 11, 21, 3, 0))).toBe(berlin(2026, 11, 21, 7, 0));
    expect(ruhezeitEnde(NACHT, berlin(2026, 11, 21, 6, 59))).toBe(berlin(2026, 11, 21, 7, 0));
    expect(ruhezeitEnde(NACHT, berlin(2026, 11, 21, 7, 0))).toBeUndefined();
  });

  it("run within one day when bis comes after von", () => {
    const mittag = { von: "12:00", bis: "13:30" };
    expect(ruhezeitEnde(mittag, berlin(2026, 11, 20, 11, 59))).toBeUndefined();
    expect(ruhezeitEnde(mittag, berlin(2026, 11, 20, 12, 45))).toBe(berlin(2026, 11, 20, 13, 30));
    expect(ruhezeitEnde(mittag, berlin(2026, 11, 20, 13, 30))).toBeUndefined();
  });

  it("count the Berlin clock, not UTC", () => {
    // 21:30 UTC in November is 22:30 in Berlin
    expect(ruhezeitEnde(NACHT, Date.parse("2026-11-20T21:30:00Z"))).toBe(
      Date.parse("2026-11-21T06:00:00Z"),
    );
    // in July Berlin is two hours ahead: 05:30 UTC is 07:30, past the end
    expect(ruhezeitEnde(NACHT, Date.parse("2026-07-21T05:30:00Z"))).toBeUndefined();
  });

  it("are an hour shorter in the night to summer time and an hour longer in the night back", () => {
    // 29 March 2026: 02:00 becomes 03:00; 25 October 2026: 03:00 becomes 02:00
    const fruehling = berlin(2026, 3, 28, 22, 0);
    expect(ruhezeitEnde(NACHT, fruehling)).toBe(berlin(2026, 3, 29, 7, 0));
    expect((ruhezeitEnde(NACHT, fruehling) ?? 0) - fruehling).toBe(8 * STUNDE);
    const herbst = berlin(2026, 10, 24, 22, 0);
    expect(ruhezeitEnde(NACHT, herbst)).toBe(berlin(2026, 10, 25, 7, 0));
    expect((ruhezeitEnde(NACHT, herbst) ?? 0) - herbst).toBe(10 * STUNDE);
    // in the hour that exists twice, both instants are within
    const zweimal = Date.parse("2026-10-25T00:30:00Z");
    expect(ruhezeitEnde(NACHT, zweimal)).toBe(berlin(2026, 10, 25, 7, 0));
    expect(ruhezeitEnde(NACHT, zweimal + STUNDE)).toBe(berlin(2026, 10, 25, 7, 0));
  });

  it("end an hour later on the clock when bis falls into the skipped hour (as Temporal's compatible)", () => {
    const kurz = { von: "01:00", bis: "02:30" };
    // 02:30 does not exist on 29 March: the window ends at 03:30 summer time, 01:30 UTC
    expect(ruhezeitEnde(kurz, berlin(2026, 3, 29, 1, 30))).toBe(Date.parse("2026-03-29T01:30:00Z"));
    expect(ruhezeitEnde(kurz, Date.parse("2026-03-29T01:30:00Z"))).toBeUndefined();
  });

  it("are none without settings", () => {
    expect(ruhezeitEnde(null, berlin(2026, 11, 21, 3, 0))).toBeUndefined();
  });
});

describe("when a message may go out", () => {
  it("is at once for a fault, also in quiet hours", () => {
    const nachts = berlin(2026, 11, 21, 3, 0);
    expect(zustellbarAb(NACHT, "fehler", nachts)).toBe(nachts);
  });

  it("is the end of the quiet hours for a warning or a notice", () => {
    const nachts = berlin(2026, 11, 21, 3, 0);
    expect(zustellbarAb(NACHT, "warn", nachts)).toBe(berlin(2026, 11, 21, 7, 0));
    expect(zustellbarAb(NACHT, "info", nachts)).toBe(berlin(2026, 11, 21, 7, 0));
    expect(zustellbarAb(NACHT, "warn", berlin(2026, 11, 21, 9, 0))).toBe(
      berlin(2026, 11, 21, 9, 0),
    );
  });
});

describe("severities", () => {
  it("reach a recipient from its threshold upwards; an unknown one counts as info", () => {
    expect(schwereReicht("fehler", "warn")).toBe(true);
    expect(schwereReicht("warn", "warn")).toBe(true);
    expect(schwereReicht("info", "warn")).toBe(false);
    expect(schwereReicht("info", "info")).toBe(true);
    expect(schwereReicht("seltsam", "info")).toBe(true);
    expect(schwereReicht("seltsam", "warn")).toBe(false);
  });

  it("of a fix are those of what it fixes, so it reaches whoever heard of the fault", () => {
    expect(meldeSchwere({ schwere: "info" }, { schwere: "fehler" })).toBe("fehler");
    expect(meldeSchwere({ schwere: "info" }, { schwere: "warn" })).toBe("warn");
    expect(meldeSchwere({ schwere: "info" }, undefined)).toBe("info");
    expect(meldeSchwere({ schwere: "warn" }, undefined)).toBe("warn");
    expect(meldeSchwere({ schwere: "komisch" }, undefined)).toBe("info");
  });
});

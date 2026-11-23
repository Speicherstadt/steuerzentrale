import { describe, expect, it } from "vitest";
import { fristen, LINK_MAX_MS, linkGueltigBis, vertragsphase } from "./kuendigung.ts";
import { instantVon } from "./zeit.ts";

const utc = (text: string) => Date.parse(text);

describe("the deadlines after a contract's end", () => {
  it("counts calendar days in Berlin: 30 days read only, deletion after 90", () => {
    const ende = instantVon(2026, 11, 30, 0, 0);
    expect(fristen(ende)).toEqual({
      nurLesenBis: instantVon(2026, 12, 30, 0, 0),
      loeschenAb: instantVon(2027, 2, 28, 0, 0),
    });
  });

  it("moves neither deadline by the hour daylight saving time changes in between", () => {
    // ends in winter, the deletion is in summer: 90 days of Berlin, one hour less than 90 × 24 h
    const ende = instantVon(2027, 2, 1, 0, 0);
    const { loeschenAb } = fristen(ende);
    expect(loeschenAb).toBe(utc("2027-05-01T22:00:00Z"));
    expect(loeschenAb - ende).toBe(90 * 24 * 3600_000 - 3600_000);
    // ends in summer, read only ends in winter: one hour more than 30 × 24 h
    const sommer = instantVon(2026, 10, 10, 0, 0);
    expect(fristen(sommer).nurLesenBis).toBe(utc("2026-11-08T23:00:00Z"));
  });

  it("is in each phase from its first millisecond on, never before", () => {
    const ende = instantVon(2026, 11, 30, 0, 0);
    const { nurLesenBis, loeschenAb } = fristen(ende);
    expect(vertragsphase(null, ende)).toBe("laeuft");
    expect(vertragsphase(ende, ende - 1)).toBe("laeuft");
    expect(vertragsphase(ende, ende)).toBe("nur_lesen");
    expect(vertragsphase(ende, nurLesenBis - 1)).toBe("nur_lesen");
    expect(vertragsphase(ende, nurLesenBis)).toBe("wartet");
    expect(vertragsphase(ende, loeschenAb - 1)).toBe("wartet");
    expect(vertragsphase(ende, loeschenAb)).toBe("loeschen");
  });

  it("makes a link valid for seven days at most and never past the 30 days", () => {
    const ende = instantVon(2026, 11, 30, 0, 0);
    const { nurLesenBis } = fristen(ende);
    expect(linkGueltigBis(ende, ende + 1000)).toBe(ende + 1000 + LINK_MAX_MS);
    expect(linkGueltigBis(ende, nurLesenBis - 3600_000)).toBe(nurLesenBis);
    expect(linkGueltigBis(ende, nurLesenBis)).toBeUndefined();
    expect(linkGueltigBis(ende, ende - 1)).toBeUndefined();
    expect(linkGueltigBis(null, ende)).toBeUndefined();
  });
});

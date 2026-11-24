import { describe, expect, it } from "vitest";
import { plattenProStunde, plattenVon } from "./platten.ts";

const STUNDE = 3_600_000;
const T = Date.UTC(2026, 10, 24, 10);

describe("plattenProStunde", () => {
  it("keeps the fullest reading of each hour per mount, oldest hour first", () => {
    const stunden = plattenProStunde([
      { zeitpunkt: T + STUNDE + 60_000, platten: [{ mount: "/", gesamtMb: 1000, freiMb: 500 }] },
      { zeitpunkt: T, platten: [{ mount: "/", gesamtMb: 1000, freiMb: 600 }] },
      {
        zeitpunkt: T + 15 * 60_000,
        platten: [
          { mount: "/var", gesamtMb: 2000, freiMb: 1000 },
          { mount: "/", gesamtMb: 1000, freiMb: 550 },
        ],
      },
      { zeitpunkt: T + 30 * 60_000, platten: [{ mount: "/", gesamtMb: 1000, freiMb: 700 }] },
    ]);
    expect(stunden).toEqual([
      {
        stunde: T,
        platten: [
          { mount: "/", prozent: 45 },
          { mount: "/var", prozent: 50 },
        ],
      },
      { stunde: T + STUNDE, platten: [{ mount: "/", prozent: 50 }] },
    ]);
  });

  it("adds nothing for a report without disks or a disk without size", () => {
    expect(
      plattenProStunde([
        { zeitpunkt: T, platten: null },
        { zeitpunkt: T, platten: [{ mount: "/", gesamtMb: 0, freiMb: 0 }] },
      ]),
    ).toEqual([]);
  });

  it("rounds to a tenth of a percent", () => {
    const [stunde] = plattenProStunde([
      { zeitpunkt: T, platten: [{ mount: "/", gesamtMb: 3000, freiMb: 1000 }] },
    ]);
    expect(stunde?.platten[0]?.prozent).toBe(66.7);
  });
});

describe("plattenVon", () => {
  it("starts the days at the hour that makes them whole, the current one included", () => {
    expect(plattenVon(1, T + 25 * 60_000)).toBe(T - 23 * STUNDE);
    expect(plattenVon(30, T)).toBe(T - (30 * 24 - 1) * STUNDE);
  });
});

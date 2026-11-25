import { describe, expect, it } from "vitest";
import { arbeitsspeicherPruefen, lastProStunde } from "./last.ts";

/*
 * BAULISTE.md Z-1106: per hour the highest reading, memory as a share of the RAM, per user in MiB;
 * a report without values adds nothing; memory over 90 % yellow, over 95 % red.
 */
const H = Date.UTC(2026, 10, 23, 10);
const M = 60_000;

const messung = (
  zeitpunkt: number,
  cpu: number | null,
  belegt: number | null,
  nutzerRam = 100,
) => ({
  zeitpunkt,
  ramMb: 8000,
  last: {
    cpuProzent: cpu,
    last1: 0.5,
    ramBelegtMb: belegt,
    nutzer: [{ name: "sz-haben", cpuProzent: cpu, ramMb: nutzerRam }],
  },
});

describe("lastProStunde", () => {
  it("keeps each hour's highest reading", () => {
    expect(
      lastProStunde([
        messung(H, null, 4000, 300),
        messung(H + 15 * M, 40, 2000, 200),
        messung(H + 30 * M, 20, 6000, 100),
        { zeitpunkt: H + 45 * M, ramMb: 8000, last: null },
        messung(H + 60 * M, 10, 800),
      ]),
    ).toEqual([
      {
        stunde: H,
        cpuProzent: 40,
        last1: 0.5,
        ramProzent: 75,
        nutzer: { "sz-haben": { cpuProzent: 40, ramMb: 300 } },
      },
      {
        stunde: H + 60 * M,
        cpuProzent: 10,
        last1: 0.5,
        ramProzent: 10,
        nutzer: { "sz-haben": { cpuProzent: 10, ramMb: 100 } },
      },
    ]);
  });

  it("is empty without readings", () => {
    expect(lastProStunde([{ zeitpunkt: H, ramMb: 8000, last: null }])).toEqual([]);
  });
});

describe("arbeitsspeicherPruefen", () => {
  it.each([
    [7200, "gruen"],
    [7201, "gelb"],
    [7600, "gelb"],
    [7601, "rot"],
  ] as const)("rates %i of 8000 MiB as %s", (belegt, ergebnis) => {
    expect(arbeitsspeicherPruefen(8000, belegt).ergebnis).toBe(ergebnis);
  });

  it("is unknown without the RAM or a reading, never green", () => {
    expect(arbeitsspeicherPruefen(null, 100).ergebnis).toBe("unbekannt");
    expect(arbeitsspeicherPruefen(8000, null).ergebnis).toBe("unbekannt");
  });
});

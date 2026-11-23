import { describe, expect, it } from "vitest";
import {
  type LeistungsEingaben,
  leistungenImMonat,
  monatAusText,
  monatText,
  speicherImMonat,
  supportMinutenImMonat,
} from "./leistungen.ts";
import { monatsGrenzen } from "./verfuegbarkeit.ts";
import { instantVon } from "./zeit.ts";

/*
 * BAULISTE.md Z-804: what each customer used in a month, summed from what happened (installations
 * set up, backup runs, support accesses, checks from outside); a month is a calendar month in
 * Europe/Berlin (docs/plan.md, "Leistungen").
 */

const MIN = 60_000;
const STUNDE = 60 * MIN;
const NOVEMBER = { jahr: 2026, monat: 11 };
const g = monatsGrenzen(NOVEMBER);
/** 15 November 2026, 12:00 in Berlin */
const MITTE = instantVon(2026, 11, 15, 12, 0);
const NACH_MONAT = instantVon(2026, 12, 2, 12, 0);

const KUNDE = { kundeId: "k1", intern: false, vertragBeginn: 0, vertragEnde: null };

const eingaben = (teil: Partial<LeistungsEingaben>): LeistungsEingaben => ({
  kunden: [KUNDE],
  installationen: [],
  scheiben: [],
  backups: [],
  zugaenge: [],
  ...teil,
});

describe("month as text", () => {
  it("reads YYYY-MM and nothing else", () => {
    expect(monatAusText("2026-11")).toEqual(NOVEMBER);
    expect(monatAusText("2026-01")).toEqual({ jahr: 2026, monat: 1 });
    for (const falsch of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "", "abcd-ef"])
      expect(monatAusText(falsch), falsch).toBeUndefined();
  });

  it("writes it back with two digits", () => {
    expect(monatText({ jahr: 2026, monat: 3 })).toBe("2026-03");
  });
});

describe("support time", () => {
  it("counts each access in the month it began in Berlin, until its end or now", () => {
    const zugaenge = [
      { kundeId: "k1", beginn: MITTE, endetAm: MITTE + 45 * MIN },
      { kundeId: "k1", beginn: MITTE + STUNDE, endetAm: MITTE + 3 * STUNDE },
      // began 23:30 on 31 October in Berlin (22:30 UTC): October's, though it ran into November
      { kundeId: "k1", beginn: g.von - 30 * MIN, endetAm: g.von + 60 * MIN },
      { kundeId: "k2", beginn: MITTE, endetAm: MITTE + 10 * MIN },
    ];
    expect(supportMinutenImMonat(zugaenge, "k1", g, NACH_MONAT)).toBe(165);
    // one still running counts up to now
    expect(supportMinutenImMonat(zugaenge, "k1", g, MITTE + 90 * MIN)).toBe(75);
  });

  it("takes the first local minute of the month as its own", () => {
    const zugaenge = [{ kundeId: "k1", beginn: g.von, endetAm: g.von + 30 * MIN }];
    expect(supportMinutenImMonat(zugaenge, "k1", g, NACH_MONAT)).toBe(30);
  });
});

describe("storage", () => {
  const lauf = (zeitpunkt: number, ok: boolean, bytes: (number | undefined)[]) => ({
    installationId: "i1",
    zeitpunkt,
    ok,
    teile: bytes.map((b) => (b === undefined ? {} : { bytes: b })),
  });

  it("is the size of the newest successful run in the month, all parts together", () => {
    const laeufe = [
      lauf(MITTE - 2 * STUNDE, true, [100, 20]),
      lauf(MITTE, true, [150, 30]),
      lauf(MITTE + STUNDE, false, [999]),
      lauf(NACH_MONAT, true, [5000]),
    ];
    expect(speicherImMonat(laeufe, "i1", g)).toBe(180);
  });

  it("is unknown without a successful run or when a part has no size (an agent before Z-804)", () => {
    expect(speicherImMonat([lauf(MITTE, false, [1])], "i1", g)).toBeNull();
    expect(speicherImMonat([lauf(MITTE, true, [1, undefined])], "i1", g)).toBeNull();
    expect(speicherImMonat([], "i1", g)).toBeNull();
  });
});

describe("services of a month", () => {
  const ein = (id: string, kundeId: string, laeuftSeit: number) => ({
    installationId: id,
    kundeId,
    app: id.split("-")[0] ?? id,
    laeuftSeit,
  });

  it("sums the events of each customer: installations, storage, support, availability", () => {
    const e = eingaben({
      kunden: [KUNDE, { ...KUNDE, kundeId: "k2" }],
      installationen: [
        ein("haben-1", "k1", g.von - 10 * 24 * STUNDE),
        ein("kontext-1", "k1", MITTE),
        // set up after the month: not yet the customer's
        ein("belegt-1", "k1", NACH_MONAT),
        ein("haben-2", "k2", g.von - STUNDE),
      ],
      scheiben: [
        { installationId: "haben-1", stunde: MITTE, gemessen: 60, rot: 0 },
        { installationId: "haben-1", stunde: MITTE + STUNDE, gemessen: 60, rot: 6 },
        { installationId: "kontext-1", stunde: MITTE, gemessen: 60, rot: 30 },
        // the hour before the month began in Berlin
        { installationId: "kontext-1", stunde: g.von - STUNDE, gemessen: 60, rot: 60 },
        { installationId: "haben-2", stunde: MITTE, gemessen: 60, rot: 0 },
      ],
      backups: [
        { installationId: "haben-1", zeitpunkt: MITTE, ok: true, teile: [{ bytes: 1000 }] },
        { installationId: "kontext-1", zeitpunkt: MITTE, ok: true, teile: [{ bytes: 24 }] },
      ],
      zugaenge: [
        { kundeId: "k1", beginn: MITTE, endetAm: MITTE + 20 * MIN },
        { kundeId: "k2", beginn: MITTE, endetAm: MITTE + 5 * MIN },
      ],
    });
    const [k1, k2] = leistungenImMonat(e, NOVEMBER, NACH_MONAT);
    expect(k1?.kundeId).toBe("k1");
    expect(k1?.installationen.map((i) => i.installationId)).toEqual(["haben-1", "kontext-1"]);
    expect(k1?.speicherBytes).toBe(1024);
    expect(k1?.supportMinuten).toBe(20);
    // the worse of 114/120 and 30/60: the customer's row never hides a bad installation
    expect(k1?.verfuegbarkeit.anteil).toBe(0.5);
    expect(k1?.verfuegbarkeit.gemessen).toBe(180);
    expect(k1?.installationen[0]?.verfuegbarkeit.anteil).toBe(114 / 120);
    expect(k1?.installationen[1]?.speicherBytes).toBe(24);
    expect(k2?.installationen).toHaveLength(1);
    expect(k2?.speicherBytes).toBeNull();
    expect(k2?.supportMinuten).toBe(5);
    expect(k2?.verfuegbarkeit.anteil).toBe(1);
  });

  it("counts the minutes of the month across the change to winter time", () => {
    // October 2026 has 31 days and one hour more: the clocks go back on 25 October
    const oktober = { jahr: 2026, monat: 10 };
    const [k] = leistungenImMonat(
      eingaben({ installationen: [ein("haben-1", "k1", 0)] }),
      oktober,
      NACH_MONAT,
    );
    expect(k?.verfuegbarkeit.minuten).toBe((31 * 24 + 1) * 60);
    expect(k?.verfuegbarkeit.anteil).toBeNull();
  });

  it("names only customers whose contract ran in the month, never our own", () => {
    const e = eingaben({
      kunden: [
        { ...KUNDE, kundeId: "neu", vertragBeginn: NACH_MONAT },
        { ...KUNDE, kundeId: "alt", vertragEnde: g.von - 1 },
        { ...KUNDE, kundeId: "bis-mitte", vertragEnde: MITTE },
        { ...KUNDE, kundeId: "ab-mitte", vertragBeginn: MITTE },
        { ...KUNDE, kundeId: "intern", intern: true },
      ],
    });
    expect(leistungenImMonat(e, NOVEMBER, NACH_MONAT).map((k) => k.kundeId)).toEqual([
      "bis-mitte",
      "ab-mitte",
    ]);
  });

  it("gives a customer without installations zeros, not a made-up availability", () => {
    const [k] = leistungenImMonat(eingaben({}), NOVEMBER, NACH_MONAT);
    expect(k).toMatchObject({
      installationen: [],
      speicherBytes: null,
      supportMinuten: 0,
      verfuegbarkeit: { anteil: null, gemessen: 0 },
    });
  });
});

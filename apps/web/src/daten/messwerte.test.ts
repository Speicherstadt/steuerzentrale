import type { TagesVerfuegbarkeit } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import type { BackupLauf } from "./backups.ts";
import {
  ausfaelle,
  backupGroessen,
  gesamtAnteil,
  monateDerTage,
  skalaMax,
  tagTon,
} from "./messwerte.ts";

// The tab "Messwerte": only what the Zentrale measures (docs/aussen.md, docs/backups.md)
const tag = (t: number, gemessen: number, rot: number, monat = 11): TagesVerfuegbarkeit => ({
  jahr: 2026,
  monat,
  tag: t,
  von: Date.UTC(2026, monat - 1, t),
  gemessen,
  rot,
  anteil: gemessen === 0 ? null : (gemessen - rot) / gemessen,
});

const TAG = 86_400_000;
const JETZT = Date.UTC(2026, 10, 20, 10);

const lauf = (vorTagen: number, bytes: (number | undefined)[], ok = true): BackupLauf => ({
  id: `l${vorTagen}`,
  zeitpunkt: JETZT - vorTagen * TAG,
  ok,
  grund: ok ? null : "restic exit 1",
  teile: bytes.map((b, n) => ({ tag: `t${n}`, ok, ...(b === undefined ? {} : { bytes: b }) })),
});

describe("the availability bars", () => {
  it("colour a day green at 100 %, yellow below, red below 99 %, grey without a check", () => {
    expect(tagTon(tag(1, 1440, 0))).toBe("ok");
    expect(tagTon(tag(1, 1440, 1))).toBe("warn");
    expect(tagTon(tag(1, 1440, 14))).toBe("warn");
    expect(tagTon(tag(1, 1440, 15))).toBe("danger");
    expect(tagTon(tag(1, 0, 0))).toBe("leer");
  });

  it("add up the measured minutes, the red days and minutes, and the months shown", () => {
    const tage = [tag(30, 1440, 0, 10), tag(31, 1440, 38, 10), tag(1, 0, 0), tag(2, 1440, 2)];
    expect(gesamtAnteil(tage)).toBe((4320 - 40) / 4320);
    expect(ausfaelle(tage)).toEqual({ tage: 2, minuten: 40 });
    expect(monateDerTage(tage)).toEqual([
      { jahr: 2026, monat: 11, anteil: (1440 - 2) / 1440 },
      { jahr: 2026, monat: 10, anteil: (2880 - 38) / 2880 },
    ]);
    expect(gesamtAnteil([tag(1, 0, 0)])).toBeNull();
  });
});

describe("the size of the nightly backups", () => {
  it("scales from 0 to a round number at least a tenth above the largest value", () => {
    expect(skalaMax(614)).toBe(800);
    expect(skalaMax(512)).toBe(600);
    expect(skalaMax(90)).toBe(100);
    expect(skalaMax(7.9)).toBe(10);
    expect(skalaMax(1.1)).toBe(1.5);
    expect(skalaMax(0)).toBe(1.5);
  });

  it("takes the successful runs with sizes in the range, oldest first", () => {
    const laeufe = [
      lauf(0.3, [400, 200]),
      lauf(1.3, [390, 200]),
      lauf(2.3, [undefined, 200]),
      lauf(3.3, [1, 1], false),
      lauf(8.3, [100, 100]),
    ];
    expect(backupGroessen(laeufe, "24h", JETZT)).toEqual([
      { zeitpunkt: JETZT - 0.3 * TAG, wert: 600 },
    ]);
    expect(backupGroessen(laeufe, "7t", JETZT).map((p) => p.wert)).toEqual([590, 600]);
    expect(backupGroessen(laeufe, "30t", JETZT).map((p) => p.wert)).toEqual([200, 590, 600]);
  });
});

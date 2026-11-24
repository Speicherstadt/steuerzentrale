import type { PlattenStunde } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import { plattenReihen } from "./auslastung.ts";

const STUNDE = 3_600_000;
const JETZT = Date.UTC(2026, 10, 20, 9, 42);
const STUNDE_JETZT = Date.UTC(2026, 10, 20, 9);

/** Hours back from the current one, oldest first, "/" at the given share */
const stunden = (werte: number[]): PlattenStunde[] =>
  werte.map((prozent, n) => ({
    stunde: STUNDE_JETZT - (werte.length - 1 - n) * STUNDE,
    platten: [{ mount: "/", prozent }],
  }));

describe("the disk over a range", () => {
  it("shows each hour of the last 24, the newest value and the change", () => {
    const [reihe] = plattenReihen(stunden([40, 41, 42.5]), "24h", JETZT);
    expect(reihe?.mount).toBe("/");
    expect(reihe?.punkte.map((p) => p.wert)).toEqual([40, 41, 42.5]);
    expect(reihe?.aktuell).toBe(42.5);
    expect(reihe?.aenderung).toBe(2.5);
    expect(reihe?.punkte.every((p) => p.zeitpunkt <= JETZT)).toBe(true);
  });

  it("leaves out what is older than the range", () => {
    const [reihe] = plattenReihen(stunden([10, ...Array(24).fill(50)]), "24h", JETZT);
    expect(reihe?.punkte.map((p) => p.wert)).not.toContain(10);
  });

  it("takes the fullest hour of each day over 30 days, so a peak stays", () => {
    const werte = Array.from({ length: 48 }, (_, n) => (n === 30 ? 90 : 40));
    const [reihe] = plattenReihen(stunden(werte), "30t", JETZT);
    expect(reihe?.punkte.length).toBeLessThanOrEqual(3);
    expect(Math.max(...(reihe?.punkte.map((p) => p.wert) ?? []))).toBe(90);
    expect(reihe?.aktuell).toBe(40);
  });

  it("gives one series per mount point, by name, and none without hours", () => {
    const zwei: PlattenStunde[] = [
      {
        stunde: STUNDE_JETZT,
        platten: [
          { mount: "/var", prozent: 70 },
          { mount: "/", prozent: 30 },
        ],
      },
    ];
    expect(plattenReihen(zwei, "7t", JETZT).map((r) => [r.mount, r.aktuell, r.aenderung])).toEqual([
      ["/", 30, null],
      ["/var", 70, null],
    ]);
    expect(plattenReihen([], "7t", JETZT)).toEqual([]);
  });
});

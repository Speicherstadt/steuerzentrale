import { describe, expect, it } from "vitest";
import { BACKUP_STAND_MS, type MeldungenDeps, meldungenStarten } from "./meldungen.ts";
import type { Planer } from "./verbinden.ts";

/*
 * BAULISTE.md Z-601: while connected, the agent looks for backup runs not yet reported right after
 * willkommen (marked as the first round of the connection) and then every minute; a round still
 * running is not started twice, and once the connection ends nothing more goes out.
 */
const aufgebaut = (backups: NonNullable<MeldungenDeps["backups"]>) => {
  const plaene: { ms: number; lauf: () => void; aktiv: boolean }[] = [];
  const planen: Planer = (lauf, ms) => {
    const p = { ms, lauf, aktiv: true };
    plaene.push(p);
    return () => {
      p.aktiv = false;
    };
  };
  const gesendet: string[] = [];
  const stoppen = meldungenStarten(
    {
      planen,
      log: () => {},
      fakten: async () => {
        throw new Error("not in this test");
      },
      anmeldungen: () => ({ stoppen: () => {} }),
      backups,
    },
    (t) => gesendet.push(t),
    null,
  );
  const takt = async () => {
    const p = plaene.find((x) => x.aktiv && x.ms === BACKUP_STAND_MS);
    if (!p) return false;
    p.aktiv = false;
    p.lauf();
    await new Promise((r) => setTimeout(r, 0));
    return true;
  };
  return { stoppen, takt, gesendet };
};

describe("reporting backup runs", () => {
  it("looks at once, as the first round of the connection, and then every minute", async () => {
    expect(BACKUP_STAND_MS).toBe(60_000);
    const runden: boolean[] = [];
    const a = aufgebaut(async (senden, erste) => {
      runden.push(erste);
      senden("{}");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(await a.takt()).toBe(true);
    expect(await a.takt()).toBe(true);
    expect(runden).toEqual([true, false, false]);
    expect(a.gesendet).toHaveLength(3);
  });

  it("starts no round while one runs", async () => {
    let fertig: (() => void) | undefined;
    let runden = 0;
    const a = aufgebaut(
      () =>
        new Promise((ja) => {
          runden += 1;
          fertig = ja;
        }),
    );
    expect(await a.takt()).toBe(true);
    expect(runden).toBe(1);
    fertig?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(await a.takt()).toBe(true);
    expect(runden).toBe(2);
  });

  it("sends nothing once the connection ended, and tells the round so", async () => {
    let spaet: ((text: string) => boolean) | undefined;
    const a = aufgebaut(async (senden) => {
      spaet = senden;
    });
    await new Promise((r) => setTimeout(r, 0));
    a.stoppen();
    expect(spaet?.("{}")).toBe(false);
    expect(a.gesendet).toEqual([]);
    expect(await a.takt()).toBe(false);
  });
});

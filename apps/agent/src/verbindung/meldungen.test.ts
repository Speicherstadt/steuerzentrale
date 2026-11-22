import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import type { ZustandNachricht } from "../zustand/runde.ts";
import { type MeldungenDeps, meldungenStarten, ZUSTAND_MS } from "./meldungen.ts";
import type { Planer } from "./verbinden.ts";

/*
 * BAULISTE.md Z-403: while connected, the agent sends `zustand` right after willkommen and then
 * every 30 s (ZUSTAND_MS), and stops when the connection ends. A round still running when the next
 * is due is not started twice: the reader passed in says so with undefined (zustand/runde.ts).
 */

const ZUSTAND: ZustandNachricht = {
  typ: "zustand",
  protokoll: PROTOKOLL_VERSION,
  zeit: 1,
  installationen: [
    {
      installationId: "test-a",
      units: [{ name: "test-a-app.service", aktiv: "active" }],
      health: { zustand: "gruen", grund: "HTTP 200" },
    },
  ],
};

const aufgebaut = (zustand: MeldungenDeps["zustand"]) => {
  const plaene: { ms: number; lauf: () => void; aktiv: boolean }[] = [];
  const planen: Planer = (lauf, ms) => {
    const p = { ms, lauf, aktiv: true };
    plaene.push(p);
    return () => {
      p.aktiv = false;
    };
  };
  const gesendet: { typ: string }[] = [];
  const stoppen = meldungenStarten(
    {
      planen,
      log: () => {},
      fakten: async () => {
        throw new Error("not in this test");
      },
      anmeldungen: () => ({ stoppen: () => {} }),
      ...(zustand ? { zustand } : {}),
    },
    (t) => gesendet.push(JSON.parse(t)),
    null,
  );
  /** Runs the next planned report of the state */
  const takt = async () => {
    const p = plaene.find((x) => x.aktiv && x.ms === ZUSTAND_MS);
    if (!p) return false;
    p.aktiv = false;
    p.lauf();
    await new Promise((r) => setTimeout(r, 0));
    return true;
  };
  const zustaende = () => gesendet.filter((n) => n.typ === "zustand");
  return { stoppen, takt, zustaende, gesendet };
};

describe("reporting the state of the installations", () => {
  it("sends zustand at once and then every 30 s", async () => {
    expect(ZUSTAND_MS).toBe(30_000);
    const a = aufgebaut(async () => ZUSTAND);
    await new Promise((r) => setTimeout(r, 0));
    expect(a.zustaende()).toEqual([ZUSTAND]);
    expect(await a.takt()).toBe(true);
    expect(await a.takt()).toBe(true);
    expect(a.zustaende()).toHaveLength(3);
  });

  it("sends nothing for a round that was skipped or failed, and keeps its beat", async () => {
    let mal = 0;
    const a = aufgebaut(async () => {
      mal += 1;
      if (mal === 1) return undefined;
      if (mal === 2) throw new Error("kaputt");
      return ZUSTAND;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(await a.takt()).toBe(true);
    expect(await a.takt()).toBe(true);
    expect(a.zustaende()).toEqual([ZUSTAND]);
  });

  it("stops with the connection: no further round, and a late one is not sent", async () => {
    let fertig: ((n: ZustandNachricht) => void) | undefined;
    const a = aufgebaut(
      () =>
        new Promise((ja) => {
          fertig = ja;
        }),
    );
    a.stoppen();
    fertig?.(ZUSTAND);
    await new Promise((r) => setTimeout(r, 0));
    expect(await a.takt()).toBe(false);
    expect(a.zustaende()).toEqual([]);
  });
});

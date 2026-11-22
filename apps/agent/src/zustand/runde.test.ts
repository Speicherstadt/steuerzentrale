import { PROTOKOLL_VERSION, schreiben, Zustand } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { gedaechtnisOeffnen } from "../einrichtung/gedaechtnis.ts";
import type { Nutzer } from "../einrichtung/nutzer.ts";
import { einzeln, zustandLesen, zustandMelder } from "./runde.ts";
import { type Antworten, haengt, pruefDeps } from "./testdeps.ts";

/*
 * BAULISTE.md Z-403: one round of checks over every installation the agent finished setting up,
 * as one `zustand` message; an entry from before Z-403 without a target is unknown, never green;
 * an installation still `angelegt` is not reported; a round still running is not started twice.
 */

const PFAD = "/z/installationen.json";

const nutzer = (name: string, uid: number): Nutzer => ({
  name,
  uid,
  gid: uid,
  home: `/home/${name}`,
});

const record = (installationen: Record<string, unknown>) =>
  speicher({ [PFAD]: JSON.stringify({ installationen }) });

const runde = (installationen: Record<string, unknown>, a: Antworten = {}) => {
  const p = pruefDeps(a);
  const g = gedaechtnisOeffnen(record(installationen).dateien, PFAD, () => 0);
  const bekannt = new Map([
    ["sz-test-a", nutzer("sz-test-a", 2001)],
    ["sz-test-k", nutzer("sz-test-k", 2002)],
  ]);
  const deps = {
    ...p.deps,
    gedaechtnis: g,
    nutzer: async (name: string) => bekannt.get(name),
    jetzt: () => 1_800_000_000_000,
  };
  return { deps, p };
};

const A = {
  zustand: "fertig",
  am: 1,
  pruefung: {
    units: ["test-a-app.service"],
    ziel: { art: "http", port: 20001, pfad: "/health" },
  },
};
const K = {
  zustand: "fertig",
  am: 1,
  pruefung: { units: ["test-k-app.service"], ziel: { art: "keine" } },
};

describe("a round of checks", () => {
  it("reports every finished installation with its units and health, as a valid message", async () => {
    const { deps } = runde(
      { "test-a": A, "test-k": K, "test-halb": { zustand: "angelegt", am: 1 } },
      {
        lesen: (argv) => ({
          code: 0,
          aus: `Id=${argv.at(-1)}\nActiveState=${String(argv.at(-1)).startsWith("test-a") ? "active" : "failed"}\n`,
        }),
      },
    );
    const r = await zustandLesen(deps);
    expect(r).toEqual({
      ok: true,
      nachricht: {
        typ: "zustand",
        protokoll: PROTOKOLL_VERSION,
        zeit: 1_800_000_000_000,
        installationen: [
          {
            installationId: "test-a",
            units: [{ name: "test-a-app.service", aktiv: "active" }],
            health: { zustand: "gruen", grund: "HTTP 200" },
          },
          {
            installationId: "test-k",
            units: [{ name: "test-k-app.service", aktiv: "failed" }],
            health: { zustand: "unbekannt", grund: "keine Prüfung" },
          },
        ],
      },
    });
    if (r.ok) expect(() => schreiben(Zustand, r.nachricht)).not.toThrow();
  });

  it("reports an entry from before Z-403 as unknown, never green, and checks nothing for it", async () => {
    const { deps, p } = runde({ "test-a": { zustand: "fertig", am: 1 } });
    expect(await zustandLesen(deps)).toMatchObject({
      ok: true,
      nachricht: {
        installationen: [
          {
            installationId: "test-a",
            units: [],
            health: {
              zustand: "unbekannt",
              grund: "Ziel der Prüfung unbekannt (vor Z-403 eingerichtet)",
            },
          },
        ],
      },
    });
    expect(p.gerufen).toEqual({ spawn: [], marken: [], lesen: [], holen: [], verbinden: [] });
  });

  it("reports units unknown when the installation's user is gone", async () => {
    const { deps, p } = runde({
      "test-weg": { ...A, pruefung: { ...A.pruefung, units: ["test-weg-app.service"] } },
    });
    expect(await zustandLesen(deps)).toMatchObject({
      ok: true,
      nachricht: {
        installationen: [{ units: [{ name: "test-weg-app.service", aktiv: "unknown" }] }],
      },
    });
    expect(p.gerufen.lesen).toEqual([]);
  });

  it("sends nothing while its record cannot be read: an empty list would read as no installations", async () => {
    const p = pruefDeps();
    const fs = speicher({ [PFAD]: "kaputt" });
    const r = await zustandLesen({
      ...p.deps,
      gedaechtnis: gedaechtnisOeffnen(fs.dateien, PFAD, () => 0),
      nutzer: async () => undefined,
      jetzt: () => 0,
    });
    expect(r).toEqual({ ok: false, grund: `${PFAD} is not the agent's record of installations` });
  });
});

describe("the reader of the reports", () => {
  it("gives the message, and nothing but a log line while the record is unreadable", async () => {
    const { deps } = runde({ "test-k": K });
    const zeilen: unknown[] = [];
    expect(await zustandMelder(deps, (msg) => zeilen.push(msg))()).toMatchObject({
      typ: "zustand",
    });
    const fs = speicher({ [PFAD]: "kaputt" });
    const kaputt = { ...deps, gedaechtnis: gedaechtnisOeffnen(fs.dateien, PFAD, () => 0) };
    expect(await zustandMelder(kaputt, (msg) => zeilen.push(msg))()).toBeUndefined();
    expect(zeilen).toEqual(["state not read"]);
  });
});

describe("one round at a time", () => {
  it("does not start a round while one still runs, and starts again once it ended", async () => {
    let ende: (() => void) | undefined;
    let runden = 0;
    const lauf = einzeln(async () => {
      runden += 1;
      await new Promise<void>((ja) => {
        ende = ja;
      });
      return runden;
    });
    const erste = lauf();
    expect(await lauf()).toBeUndefined();
    ende?.();
    expect(await erste).toBe(1);
    const zweite = lauf();
    ende?.();
    expect(await zweite).toBe(2);
  });

  it("starts again after a round that threw", async () => {
    const abbruch = new AbortController();
    let mal = 0;
    const lauf = einzeln(() => (++mal === 1 ? haengt<number>(abbruch.signal) : Promise.resolve(3)));
    const erste = lauf();
    abbruch.abort();
    await expect(erste).rejects.toThrow();
    expect(await lauf()).toBe(3);
  });
});

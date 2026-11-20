import { HEARTBEAT_MS } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { STILL_AB_MS, verbindungsZustand } from "./zustand.ts";

const JETZT = Date.UTC(2026, 10, 20, 12, 0, 0);
const MINUTE = 60_000;

describe("verbindungsZustand", () => {
  it("is connected while heartbeats arrive", () => {
    expect(
      verbindungsZustand(
        { verbundenSeit: JETZT - 10 * MINUTE, letzterHeartbeat: JETZT - HEARTBEAT_MS },
        JETZT,
      ),
    ).toEqual({ zustand: "verbunden", letzterHeartbeat: JETZT - HEARTBEAT_MS });
  });

  it("is silent, with the minutes, once heartbeats stay away on an open connection", () => {
    expect(
      verbindungsZustand(
        { verbundenSeit: JETZT - 10 * MINUTE, letzterHeartbeat: JETZT - STILL_AB_MS },
        JETZT,
      ),
    ).toEqual({ zustand: "still", letzterHeartbeat: JETZT - STILL_AB_MS, stillSeitMin: 1 });
    expect(
      verbindungsZustand(
        { verbundenSeit: JETZT - 10 * MINUTE, letzterHeartbeat: JETZT - 7.5 * MINUTE },
        JETZT,
      ),
    ).toMatchObject({ zustand: "still", stillSeitMin: 7 });
  });

  it("counts a fresh connection without a heartbeat yet from when it opened", () => {
    expect(
      verbindungsZustand({ verbundenSeit: JETZT - 5000, letzterHeartbeat: undefined }, JETZT),
    ).toEqual({
      zustand: "verbunden",
      letzterHeartbeat: null,
    });
    expect(
      verbindungsZustand({ verbundenSeit: JETZT - 3 * MINUTE, letzterHeartbeat: undefined }, JETZT),
    ).toMatchObject({ zustand: "still", stillSeitMin: 3 });
  });

  it("is disconnected without a connection, however fresh the last heartbeat", () => {
    expect(
      verbindungsZustand({ verbundenSeit: undefined, letzterHeartbeat: JETZT - 1000 }, JETZT),
    ).toEqual({
      zustand: "getrennt",
      letzterHeartbeat: JETZT - 1000,
    });
    expect(
      verbindungsZustand({ verbundenSeit: undefined, letzterHeartbeat: undefined }, JETZT),
    ).toEqual({
      zustand: "getrennt",
      letzterHeartbeat: null,
    });
  });

  it("takes a heartbeat from a clock slightly ahead as just now", () => {
    expect(
      verbindungsZustand({ verbundenSeit: JETZT, letzterHeartbeat: JETZT + 500 }, JETZT),
    ).toMatchObject({ zustand: "verbunden" });
  });
});

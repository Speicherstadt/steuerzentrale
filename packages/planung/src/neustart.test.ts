import { describe, expect, it } from "vitest";
import {
  NEUSTART_PAUSE_MS,
  type NeustartServer,
  neustartPruefen,
  neustartZustellbar,
} from "./neustart.ts";
import { instantVon } from "./zeit.ts";

/*
 * BAULISTE.md Z-701: when the Zentrale reboots a server. Only when it is needed, in the server's
 * maintenance window, outside every freeze window of the apps on it, never beside another job on
 * the server or without the backups set up, and at most once a day.
 */
const berlin = (j: number, m: number, t: number, h = 12, min = 0) => instantVon(j, m, t, h, min);
const NACHTS = { tage: [0, 1, 2, 3, 4, 5, 6], von: "02:00", bis: "04:00" };
const HABEN = [{ monatlich: "07-12", grund: "Umsatzsteuer-Voranmeldung" }];

const server = (teil: Partial<NeustartServer> = {}): NeustartServer => ({
  neustartNoetig: true,
  bootId: "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4",
  wartungsfenster: NACHTS,
  sperrzeiten: [],
  verbunden: true,
  offeneAuftraege: 0,
  ohneBackup: 0,
  ...teil,
});

describe("neustartPruefen", () => {
  it("reboots a server that needs it inside its window", () => {
    expect(neustartPruefen(server(), berlin(2026, 11, 20, 2, 30))).toEqual({ art: "jetzt" });
  });

  it("waits for the window outside it and names its start", () => {
    expect(neustartPruefen(server(), berlin(2026, 11, 20, 12))).toEqual({
      art: "warten",
      grund: "fenster",
      ab: berlin(2026, 11, 21, 2, 0),
    });
  });

  it("postpones the reboot while a freeze window of an app on the server runs", () => {
    // the window of the 8th is open, but Haben is frozen from the 7th to the 12th
    expect(neustartPruefen(server({ sperrzeiten: HABEN }), berlin(2026, 11, 8, 2, 30))).toEqual({
      art: "warten",
      grund: "sperrzeit",
      ab: berlin(2026, 11, 13, 2, 0),
    });
    // the day before the freeze window the reboot runs
    expect(neustartPruefen(server({ sperrzeiten: HABEN }), berlin(2026, 11, 6, 2, 30))).toEqual({
      art: "jetzt",
    });
  });

  it("keeps the wall time of its window across the change to summer time", () => {
    // 29.03.2026: 02:00 jumps to 03:00, the window opens at 03:00 (the gap moves the start on)
    const entscheid = neustartPruefen(server(), berlin(2026, 3, 28, 12));
    expect(entscheid).toEqual({
      art: "warten",
      grund: "fenster",
      ab: Date.parse("2026-03-29T01:00:00Z"),
    });
    expect(neustartPruefen(server(), Date.parse("2026-03-29T01:30:00Z"))).toEqual({
      art: "jetzt",
    });
    // the next night 02:00 is UTC+2
    expect(neustartPruefen(server(), Date.parse("2026-03-30T00:00:00Z"))).toEqual({
      art: "jetzt",
    });
    expect(neustartPruefen(server(), Date.parse("2026-03-29T23:59:00Z"))).toMatchObject({
      grund: "fenster",
    });
  });

  it("does nothing for a server that needs no reboot or does not say", () => {
    const nachts = berlin(2026, 11, 20, 2, 30);
    expect(neustartPruefen(server({ neustartNoetig: false }), nachts)).toEqual({
      art: "warten",
      grund: "nicht_noetig",
    });
    expect(neustartPruefen(server({ neustartNoetig: null }), nachts)).toMatchObject({
      grund: "unbekannt",
    });
    expect(neustartPruefen(server({ bootId: null }), nachts)).toMatchObject({
      grund: "unbekannt",
    });
  });

  it("waits for its agent, for every open job and for backups set up", () => {
    const nachts = berlin(2026, 11, 20, 2, 30);
    expect(neustartPruefen(server({ verbunden: false }), nachts)).toMatchObject({
      grund: "getrennt",
    });
    expect(neustartPruefen(server({ offeneAuftraege: 1 }), nachts)).toMatchObject({
      grund: "auftraege",
    });
    expect(neustartPruefen(server({ ohneBackup: 2 }), nachts)).toMatchObject({
      grund: "backup_fehlt",
    });
  });

  it("reboots a server at most once a day", () => {
    const nachts = berlin(2026, 11, 20, 2, 30);
    const gestern = nachts - NEUSTART_PAUSE_MS;
    expect(neustartPruefen(server({ letzterNeustartAm: gestern + 60_000 }), nachts)).toEqual({
      art: "warten",
      grund: "versucht",
      ab: nachts + 60_000,
    });
    expect(neustartPruefen(server({ letzterNeustartAm: gestern }), nachts)).toEqual({
      art: "jetzt",
    });
  });

  it("names no slot when a freeze window never ends", () => {
    const immer = [{ monatlich: "01-31", grund: "x" }];
    expect(neustartPruefen(server({ sperrzeiten: immer }), berlin(2026, 11, 20, 2, 30))).toEqual({
      art: "warten",
      grund: "kein_termin",
    });
  });
});

describe("neustartZustellbar", () => {
  it("never sends a reboot in a freeze window, whoever made it", () => {
    expect(neustartZustellbar(HABEN, NACHTS, berlin(2026, 11, 8, 2, 30))).toBe(false);
    expect(neustartZustellbar(HABEN, undefined, berlin(2026, 11, 8, 12))).toBe(false);
  });

  it("sends one of the plan only inside the window, one made by hand at any time", () => {
    expect(neustartZustellbar([], NACHTS, berlin(2026, 11, 20, 3, 59))).toBe(true);
    expect(neustartZustellbar([], NACHTS, berlin(2026, 11, 20, 4, 0))).toBe(false);
    expect(neustartZustellbar([], undefined, berlin(2026, 11, 20, 12))).toBe(true);
  });
});

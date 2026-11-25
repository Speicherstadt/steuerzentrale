import { afterEach, describe, expect, it } from "vitest";
import { zustellungen } from "../../db/schema.ts";
import { benachrichtigungsUmgebung, ereignisSchreiben } from "../../testhilfen/benachrichtigung.ts";
import { ntfyServer } from "../../testhilfen/ntfy.ts";

/*
 * BAULISTE.md Z-1105: a fault and its fix reach the ntfy test server with title and priority, as
 * one message each; a failed delivery is tried again after the wait of Z-703, as for mail and
 * webhooks.
 */
const MIN = 60_000;

const stopper: (() => unknown)[] = [];
afterEach(() => {
  for (const s of stopper.splice(0)) s();
});

const umgebung = (token: string | null = "tk_test0123456789") => {
  const s = ntfyServer(token === null ? {} : { token });
  stopper.push(s.stoppen);
  const u = benachrichtigungsUmgebung();
  u.empfaenger("b1", { art: "ntfy", url: s.url("sz-alarm"), token, abSchwere: "warn" });
  return { s, u };
};

describe("ntfy as a recipient", () => {
  it("gets a fault and its fix with title and priority", async () => {
    const { s, u } = umgebung();
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "stoerung",
      schwere: "fehler",
      ziel: "installation:i1",
      text: "Störung i1: seit 5 Min. rot",
    });
    await u.lauf();
    u.uhr.ms += 10 * MIN;
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "stoerung_behoben",
      schwere: "info",
      ziel: "installation:i1",
      text: "Störung i1 behoben: wieder grün",
    });
    await u.lauf();
    expect(s.empfangen.map((e) => [e.auth, e.json])).toEqual([
      [
        "Bearer tk_test0123456789",
        {
          topic: "sz-alarm",
          title: "Störung",
          message: "Störung i1: seit 5 Min. rot",
          priority: 5,
          tags: ["rotating_light"],
        },
      ],
      [
        "Bearer tk_test0123456789",
        {
          topic: "sz-alarm",
          title: "Behoben",
          message: "Störung i1 behoben: wieder grün",
          priority: 3,
          tags: ["white_check_mark"],
        },
      ],
    ]);
  });

  it("tries a failed delivery again after its wait", async () => {
    const { s, u } = umgebung(null);
    s.scheitern(1);
    ereignisSchreiben(u.schreibDb, "b1", {
      zeitpunkt: u.uhr.ms,
      art: "stoerung",
      schwere: "fehler",
    });
    expect(await u.lauf()).toMatchObject({ angelegt: 1, gescheitert: 1 });
    expect(u.db.select().from(zustellungen).all()).toEqual([
      expect.objectContaining({ zustand: "wartet", versuche: 1, fehler: "ntfy HTTP 503" }),
    ]);
    u.uhr.ms += MIN;
    expect(await u.lauf()).toMatchObject({ zugestellt: 1 });
    expect(s.empfangen.map((e) => e.status)).toEqual([503, 200]);
    expect(u.db.select().from(zustellungen).all()).toEqual([
      expect.objectContaining({ zustand: "zugestellt", versuche: 2 }),
    ]);
  });
});

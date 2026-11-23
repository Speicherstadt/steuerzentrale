import type { Probe } from "@steuerzentrale/planung";
import { STOERUNG_NACH_MS } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import { auditLog, ereignisse, verfuegbarkeit } from "../../db/schema.ts";
import {
  bewertungsUmgebung,
  eintrag,
  installationEinfuegen,
  zustandNachricht,
} from "../../testhilfen/bewertung.ts";
import { FAKTEN } from "../../testhilfen/installationen.ts";
import { schreiben } from "../audit/index.ts";
import { zustandAnnehmen } from "../bewertung/index.ts";
import { BEHOBEN_ART, STOERUNG_ART } from "../bewertung/lesen.ts";
import { bewertungenPruefen } from "../bewertung/pruefung.ts";
import { aussenLesen } from "./lesen.ts";
import { AUSSEN_PRUEFUNG_MS, aussenPruefen, aussenSchleife, PARALLEL } from "./pruefen.ts";
import { pruefziele } from "./ziele.ts";

/*
 * BAULISTE.md Z-704: "Agent grün, außen rot" makes an event; red outside for five minutes is a
 * fault like red inside (docs/plan.md, "Störung"), fixed only once both sides are green; one event
 * per change, not per check; every check counts into its hour for the availability. The network is
 * a fake sonde: whatever the test says a host answers.
 */

const T = Date.UTC(2026, 10, 23, 12);
const MIN = 60_000;

const gut: Probe = {
  dns: { ok: true, a: ["203.0.113.10"], aaaa: [] },
  tls: { ok: true, gueltigBis: T + 60 * 86_400_000 },
  http: { ok: true, status: 200, ms: 40 },
};
const kaputt: Probe = { ...gut, http: { ok: true, status: 503, ms: 12 } };

const umgebung = () => {
  const offen = bewertungsUmgebung();
  const uhr = { ms: T };
  const antworten = new Map<string, Probe>();
  const gefragt: string[] = [];
  const log: string[] = [];
  const deps = {
    db: offen.db,
    schreibDb: offen.schreibDb,
    now: () => uhr.ms,
    log: (z: string) => log.push(z),
    sonde: async (host: string, pfad: string) => {
      gefragt.push(`${host}${pfad}`);
      return antworten.get(host) ?? gut;
    },
  };
  /** One run of checks at `t`, and the agent's report of i1 (b1) at the same time */
  const minute = async (t: number, innen: "gruen" | "rot" = "gruen") => {
    uhr.ms = t;
    zustandAnnehmen(
      { ...deps, log: () => {} },
      { betreiberId: "b1", serverId: "s1" },
      zustandNachricht([eintrag("i1", innen)]),
      t,
    );
    await aussenPruefen(deps);
  };
  const laufen = async (von: number, bis: number, innen: "gruen" | "rot" = "gruen") => {
    for (let t = von; t < bis; t += MIN) await minute(t, innen);
  };
  const arten = (betreiberId = "b1") =>
    offen.db
      .select()
      .from(ereignisse)
      .all()
      .filter((e) => e.betreiberId === betreiberId && e.ziel === "installation:i1")
      .map((e) => [e.zeitpunkt, e.art, e.schwere]);
  return { ...offen, uhr, antworten, gefragt, log, deps, minute, laufen, arten };
};

describe("Agent grün, außen rot", () => {
  it("makes one event `aussen_rot` after the second red check, with the reason and the agent's green", async () => {
    const u = umgebung();
    u.antworten.set("i1.kanzlei.example", kaputt);
    await u.minute(T);
    expect(u.arten()).toEqual([]);
    await u.laufen(T + MIN, T + 4 * MIN);
    expect(u.arten()).toEqual([[T + MIN, "aussen_rot", "warn"]]);
    const e = u.db.select().from(ereignisse).all()[0];
    expect(e?.text).toBe(
      "Von außen rot: i1 (i1.kanzlei.example): Health: HTTP 503; Agent meldet grün",
    );
  });

  it("is a fault after five minutes, fixed once green outside, each change one event", async () => {
    const u = umgebung();
    u.antworten.set("i1.kanzlei.example", kaputt);
    await u.laufen(T, T + STOERUNG_NACH_MS + MIN);
    u.antworten.delete("i1.kanzlei.example");
    await u.laufen(T + 10 * MIN, T + 15 * MIN);
    expect(u.arten()).toEqual([
      [T + MIN, "aussen_rot", "warn"],
      [T + STOERUNG_NACH_MS, STOERUNG_ART, "fehler"],
      [T + 10 * MIN, "aussen_gruen", "info"],
      [T + 10 * MIN, BEHOBEN_ART, "info"],
    ]);
    const stoerung = u.db
      .select()
      .from(ereignisse)
      .all()
      .find((e) => e.art === STOERUNG_ART);
    expect(stoerung?.text).toBe("Störung i1: seit 5 Min. außen rot; Health: HTTP 503");
    const audit = u.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.betreiberId === "b1" && a.aktion.startsWith("ereignis."))
      .map((a) => [a.aktion, a.akteur]);
    expect(audit).toEqual([
      ["ereignis.aussen-rot", "system"],
      ["ereignis.stoerung", "system"],
      ["ereignis.aussen-gruen", "system"],
      ["ereignis.stoerung-behoben", "system"],
    ]);
  });

  it("is not fixed by the agent's green while outside stays red, nor by its 30-second check", async () => {
    const u = umgebung();
    u.antworten.set("i1.kanzlei.example", kaputt);
    await u.laufen(T, T + 20 * MIN);
    bewertungenPruefen(u.db, u.schreibDb, T + 20 * MIN - 30_000);
    expect(u.arten().map((a) => a[1])).toEqual(["aussen_rot", STOERUNG_ART]);
  });

  it("reports no change for a single red check", async () => {
    const u = umgebung();
    u.antworten.set("i1.kanzlei.example", kaputt);
    await u.minute(T);
    u.antworten.delete("i1.kanzlei.example");
    await u.laufen(T + MIN, T + 5 * MIN);
    expect(u.arten()).toEqual([]);
  });

  it("belongs to its operator: the same name with another operator stays green", async () => {
    const u = umgebung();
    u.antworten.set("i1.kanzlei.example", kaputt);
    await u.laufen(T, T + 3 * MIN);
    expect(u.arten("b1").length).toBeGreaterThan(0);
    // b2's i1 has the same host in this test and so the same answer; its events stay its own
    expect(u.arten("b2").map((a) => a[1])).toEqual(["aussen_rot"]);
    const zeilen = u.db.select().from(ereignisse).all();
    expect(new Set(zeilen.map((e) => `${e.betreiberId}:${e.ziel}`))).toEqual(
      new Set(["b1:installation:i1", "b2:installation:i1"]),
    );
  });
});

describe("availability", () => {
  it("counts every check into its hour, red ones apart, per operator", async () => {
    const u = umgebung();
    u.antworten.set("i1.kanzlei.example", kaputt);
    await u.laufen(T, T + 10 * MIN);
    u.antworten.delete("i1.kanzlei.example");
    await u.laufen(T + 10 * MIN, T + 60 * MIN);
    const zeilen = u.db
      .select()
      .from(verfuegbarkeit)
      .all()
      .filter((z) => z.installationId === "i1");
    expect(zeilen).toEqual([
      { betreiberId: "b1", installationId: "i1", stunde: T, gemessen: 60, rot: 10 },
      { betreiberId: "b2", installationId: "i1", stunde: T, gemessen: 60, rot: 10 },
    ]);
    const november = aussenLesen(u.db, "b1", "i1", T + 60 * MIN).verfuegbarkeit[0];
    expect(november).toMatchObject({
      jahr: 2026,
      monat: 11,
      gemessen: 60,
      rot: 10,
      anteil: 50 / 60,
    });
  });
});

describe("what is checked", () => {
  it("is every running installation with an HTTP service, with its health path, a few at a time", async () => {
    const u = umgebung();
    installationEinfuegen(u.schreibDb, "b1", "weg", "s1", { zustand: "entfernt" });
    installationEinfuegen(u.schreibDb, "b1", "ohne", "s1", { app: "stumm" });
    await u.minute(T);
    expect(u.gefragt.sort()).toEqual([
      "i1.kanzlei.example/health",
      "i1.kanzlei.example/health",
      "i2.kanzlei.example/health",
      "ohne.kanzlei.example/",
    ]);
    expect(PARALLEL).toBeGreaterThan(1);
  });

  it("expects the addresses the Zentrale set, from the server's facts, once its records are set", () => {
    const u = umgebung();
    const kontext = { betreiberId: "b1", akteur: "test", jetzt: T, grund: "Test" };
    schreiben(u.schreibDb, kontext, "test", (w) => {
      w.aendern(
        "server",
        { serverId: "s1" },
        { fakten: JSON.stringify({ ...FAKTEN, ipv4: ["203.0.113.10"], ipv6: ["2001:db8::1"] }) },
      );
      w.aendern("installationen", { installationId: "i1" }, { dns: "gesetzt" });
    });
    const ziele = pruefziele(u.db).filter((z) => z.installation.betreiberId === "b1");
    expect(ziele.map((z) => [z.installation.installationId, z.soll])).toEqual([
      ["i1", { A: "203.0.113.10", AAAA: "2001:db8::1" }],
      ["i2", null],
    ]);
  });

  it("logs a check that throws and goes on with the others", async () => {
    const u = umgebung();
    const deps = {
      ...u.deps,
      sonde: async (host: string) => {
        if (host === "i2.kanzlei.example") throw new Error("kaputt");
        return gut;
      },
    };
    expect(await aussenPruefen(deps)).toBe(3);
    expect(u.log.map((z) => JSON.parse(z))).toEqual([
      expect.objectContaining({ msg: "check from outside failed", installationId: "i2" }),
    ]);
    expect(aussenLesen(u.db, "b1", "i1", T).aussen?.zustand).toBe("gruen");
  });
});

describe("aussenSchleife", () => {
  it("checks every minute, and a run still going makes the next fall out", async () => {
    const u = umgebung();
    const geplant: { lauf: () => void; ms: number }[] = [];
    let freigeben = () => {};
    const haengt = new Promise<void>((r) => {
      freigeben = r;
    });
    let laeufe = 0;
    aussenSchleife(
      {
        ...u.deps,
        sonde: async () => {
          laeufe += 1;
          await haengt;
          return gut;
        },
      },
      (lauf, ms) => geplant.push({ lauf, ms }),
    );
    expect(geplant.map((g) => g.ms)).toEqual([AUSSEN_PRUEFUNG_MS]);
    geplant[0]?.lauf();
    geplant[0]?.lauf();
    await Promise.resolve();
    expect(laeufe).toBe(3);
    freigeben();
  });
});

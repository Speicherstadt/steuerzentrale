import { MELDUNG_FRIST_MS, STOERUNG_NACH_MS } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import { auditLog, ereignisse, installationen } from "../../db/schema.ts";
import { bewertungsUmgebung, eintrag, zustandNachricht } from "../../testhilfen/bewertung.ts";
import { BEHOBEN_ART, STOERUNG_ART, verlaufLesen } from "./lesen.ts";
import { zustandAnnehmen } from "./melden.ts";
import { BEWERTUNG_PRUEFUNG_MS, bewertungenPruefen, bewertungsSchleife } from "./pruefung.ts";

/*
 * BAULISTE.md Z-403 and docs/plan.md, "Störung": without a report for 90 s an installation is
 * unknown; five minutes of continuous red make one event `stoerung`, green after it one
 * `stoerung_behoben`; unknown ends no fault. Checked at every report and every 30 s, at the time
 * handed in, so five minutes pass without waiting.
 */
const T = Date.UTC(2026, 10, 22, 12);
const S = 1_000;

const umgebung = () => {
  const offen = bewertungsUmgebung();
  const deps = { db: offen.db, schreibDb: offen.schreibDb, log: () => {} };
  const melden = (
    health: "gruen" | "rot",
    jetzt: number,
    betreiberId = "b1",
    installationId = "i1",
  ) =>
    zustandAnnehmen(
      deps,
      { betreiberId, serverId: "s1" },
      zustandNachricht([eintrag(installationId, health)]),
      jetzt,
    );
  const pruefen = (jetzt: number) => bewertungenPruefen(offen.db, offen.schreibDb, jetzt);
  /** Reports every 30 s from `von` to before `bis`, with the check 15 s after each */
  const laufen = (health: "gruen" | "rot", von: number, bis: number) => {
    for (let t = von; t < bis; t += 30 * S) {
      melden(health, t);
      if (t + 15 * S < bis) pruefen(t + 15 * S);
    }
  };
  const ereignis = (art: string) =>
    offen.db
      .select()
      .from(ereignisse)
      .all()
      .filter((e) => e.art === art);
  const bewertung = (betreiberId = "b1") =>
    offen.db
      .select()
      .from(installationen)
      .all()
      .find((i) => i.betreiberId === betreiberId && i.installationId === "i1");
  return { ...offen, melden, pruefen, laufen, ereignis, bewertung };
};

describe("unknown without a report", () => {
  it("is set 90 s after the last report, once, with the reason, and never green", () => {
    const u = umgebung();
    u.melden("gruen", T);
    u.pruefen(T + MELDUNG_FRIST_MS - 1);
    expect(u.bewertung()?.bewertung).toBe("gruen");
    u.pruefen(T + MELDUNG_FRIST_MS);
    u.pruefen(T + MELDUNG_FRIST_MS + 30 * S);
    expect(u.bewertung()).toMatchObject({
      bewertung: "unbekannt",
      bewertungSeit: T + MELDUNG_FRIST_MS,
      gemeldetAm: T,
    });
    expect(verlaufLesen(u.db, "b1", "i1").map((v) => [v.zeitpunkt, v.bewertung, v.grund])).toEqual([
      [T + MELDUNG_FRIST_MS, "unbekannt", { code: "keine_meldung", werte: {} }],
      [T, "gruen", { code: "health", werte: { text: "HTTP 200" } }],
    ]);
  });

  it("leaves an installation never reported alone", () => {
    const u = umgebung();
    u.pruefen(T + 60 * 60_000);
    expect(u.bewertung()?.bewertung).toBeNull();
  });
});

describe("a fault", () => {
  it("is one event after five minutes of red, none at 4:59", () => {
    const u = umgebung();
    u.laufen("rot", T, T + STOERUNG_NACH_MS);
    u.pruefen(T + STOERUNG_NACH_MS - S);
    expect(u.ereignis(STOERUNG_ART)).toEqual([]);
    u.melden("rot", T + STOERUNG_NACH_MS);
    expect(u.ereignis(STOERUNG_ART)).toEqual([
      expect.objectContaining({
        betreiberId: "b1",
        zeitpunkt: T + STOERUNG_NACH_MS,
        art: STOERUNG_ART,
        schwere: "fehler",
        ziel: "installation:i1",
        text: "Störung i1: seit 5 Min. rot; Health: HTTP 503",
      }),
    ]);
    u.laufen("rot", T + STOERUNG_NACH_MS + 30 * S, T + 30 * 60_000);
    expect(u.ereignis(STOERUNG_ART)).toHaveLength(1);
  });

  it("is found by the check every 30 s as well", () => {
    const u = umgebung();
    u.laufen("rot", T, T + STOERUNG_NACH_MS);
    u.pruefen(T + STOERUNG_NACH_MS);
    expect(u.ereignis(STOERUNG_ART).map((e) => e.zeitpunkt)).toEqual([T + STOERUNG_NACH_MS]);
  });

  it("is fixed once by green, written through the audit log", () => {
    const u = umgebung();
    u.laufen("rot", T, T + STOERUNG_NACH_MS + S);
    const gruen = T + 10 * 60_000;
    u.laufen("gruen", gruen, gruen + 5 * 60_000);
    expect(u.ereignis(BEHOBEN_ART)).toEqual([
      expect.objectContaining({
        zeitpunkt: gruen,
        schwere: "info",
        ziel: "installation:i1",
        text: "Störung i1 behoben: wieder grün",
      }),
    ]);
    const audit = u.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion.startsWith("ereignis.stoerung"));
    expect(audit.map((e) => [e.aktion, e.akteur, e.betreiberId])).toEqual([
      ["ereignis.stoerung", "system", "b1"],
      ["ereignis.stoerung-behoben", "system", "b1"],
    ]);
  });

  it("is not ended by unknown: red again after silence makes no second fault", () => {
    const u = umgebung();
    u.laufen("rot", T, T + STOERUNG_NACH_MS + S);
    const still = T + STOERUNG_NACH_MS + 30 * S;
    u.pruefen(still + MELDUNG_FRIST_MS);
    expect(u.bewertung()?.bewertung).toBe("unbekannt");
    const zurueck = still + 10 * 60_000;
    u.laufen("rot", zurueck, zurueck + 2 * STOERUNG_NACH_MS);
    expect(u.ereignis(STOERUNG_ART)).toHaveLength(1);
    expect(u.ereignis(BEHOBEN_ART)).toEqual([]);
  });

  it("starts anew after it was fixed", () => {
    const u = umgebung();
    u.laufen("rot", T, T + STOERUNG_NACH_MS + S);
    u.laufen("gruen", T + 6 * 60_000, T + 7 * 60_000);
    u.laufen("rot", T + 7 * 60_000, T + 13 * 60_000);
    expect(u.ereignis(STOERUNG_ART).map((e) => e.zeitpunkt)).toEqual([
      T + STOERUNG_NACH_MS,
      T + 12 * 60_000,
    ]);
  });

  it("counts only reports that come: red with the agent silent is unknown, no fault", () => {
    const u = umgebung();
    u.melden("rot", T);
    for (let t = T; t <= T + 10 * 60_000; t += 30 * S) u.pruefen(t);
    expect(u.ereignis(STOERUNG_ART)).toEqual([]);
  });

  it("belongs to its operator: the same name with another operator is another installation", () => {
    const u = umgebung();
    for (let t = T; t <= T + STOERUNG_NACH_MS; t += 30 * S) u.melden("rot", t, "b2");
    u.melden("gruen", T + STOERUNG_NACH_MS + 30 * S);
    expect(u.ereignis(STOERUNG_ART).map((e) => e.betreiberId)).toEqual(["b2"]);
    expect(u.ereignis(BEHOBEN_ART)).toEqual([]);
  });
});

describe("bewertungsSchleife", () => {
  it("checks every 30 seconds with the clock it is given", () => {
    const u = umgebung();
    u.melden("gruen", T);
    const uhr = { ms: T };
    const geplant: { lauf: () => void; ms: number }[] = [];
    bewertungsSchleife(
      u.db,
      u.schreibDb,
      () => uhr.ms,
      (lauf, ms) => geplant.push({ lauf, ms }),
      () => {},
    );
    expect(geplant.map((g) => g.ms)).toEqual([BEWERTUNG_PRUEFUNG_MS]);
    uhr.ms = T + MELDUNG_FRIST_MS;
    geplant[0]?.lauf();
    expect(u.bewertung()?.bewertung).toBe("unbekannt");
  });
});

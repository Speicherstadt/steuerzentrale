import { STOERUNG_NACH_MS } from "@steuerzentrale/planung";
import { BEOBACHTET_MAX } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { dienstInnen, ereignisse } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { betreiberAnlegen } from "../../testhilfen/bewertung.ts";
import { FAKTEN } from "../../testhilfen/installationen.ts";
import { schreiben } from "../audit/index.ts";
import { zustandAnnehmen } from "../bewertung/index.ts";
import { beobachtenNachricht } from "./beobachten.ts";
import { dienstAendern, dienstAnlegen, dienstLesen } from "./dienste.ts";
import type { Innen } from "./innen.ts";
import { dienstZeileLesen } from "./lesen.ts";
import { dienstErgebnisAnnehmen } from "./pruefen.ts";

/*
 * BAULISTE.md Z-1103, the Zentrale's side: what the agent reports about the units of an observed
 * service is rated by the same rules as an installation (green, yellow, red, unknown with a
 * reason), only for services of this server and operator; five minutes red inside make the fault,
 * fixed once inside and outside are green. The list `beobachten` names only the server's services.
 */

const T = Date.UTC(2026, 10, 25, 12);
const MIN = 60_000;

const umgebung = () => {
  const offen = testDatenbank();
  betreiberAnlegen(offen.schreibDb, "b1", ["s1", "s2"]);
  betreiberAnlegen(offen.schreibDb, "b2", ["p1"]);
  for (const [b, s] of [
    ["b1", "s1"],
    ["b1", "s2"],
    ["b2", "p1"],
  ] as const)
    schreiben(offen.schreibDb, { betreiberId: b, akteur: "t", jetzt: 1, grund: "t" }, "test", (w) =>
      w.aendern(
        "server",
        { serverId: s },
        { fakten: JSON.stringify({ ...FAKTEN, nurBeobachten: true }), faktenAm: 1 },
      ),
    );
  const zeilen: string[] = [];
  const deps = { db: offen.db, schreibDb: offen.schreibDb, log: (z: string) => zeilen.push(z) };
  const anlegen = (betreiberId: string, innen: Innen | null, name = "Kontext") => {
    const kontext = { betreiberId, akteur: "n", jetzt: T, grund: "Dienst angelegt" };
    const r = dienstAnlegen(offen.db, offen.schreibDb, kontext, {
      name,
      host: "kontext.teufel-it.de",
      pfad: "/",
      kundeId: null,
      innen,
    });
    if (!r.ok) throw new Error(r.grund);
    return r.dienst.id;
  };
  const melden = (
    serverId: string,
    dienste: { dienstId: string; aktiv?: string; health?: "gruen" | "rot" | "unbekannt" }[],
    jetzt: number,
    betreiberId = "b1",
  ) =>
    zustandAnnehmen(
      deps,
      { betreiberId, serverId },
      {
        typ: "zustand",
        protokoll: 1,
        zeit: jetzt,
        installationen: [],
        dienste: dienste.map((d) => ({
          dienstId: d.dienstId,
          units: [{ name: "kontext.service", aktiv: (d.aktiv ?? "active") as "active" }],
          health: {
            zustand: d.health ?? "gruen",
            grund: d.health === "rot" ? "keine Verbindung zu 127.0.0.1:3000" : "HTTP 200",
          },
        })),
      },
      jetzt,
    );
  const stoerungen = () =>
    offen.db
      .select()
      .from(ereignisse)
      .all()
      .filter((e) => e.art.startsWith("stoerung"))
      .map((e) => [e.art, e.text]);
  return { ...offen, deps, anlegen, melden, stoerungen, zeilen };
};

const KONTEXT: Innen = {
  serverId: "s1",
  nutzer: "tristan",
  units: ["kontext.service"],
  health: { art: "http", port: 3000, pfad: "/health" },
};

describe("reports about observed units", () => {
  it("rate green, yellow, red and unknown by the rules of an installation", () => {
    const u = umgebung();
    const id = u.anlegen("b1", KONTEXT);
    u.melden("s1", [{ dienstId: id }], T);
    expect(dienstLesen(u.db, "b1", id, T)?.innenStand).toMatchObject({
      bewertung: "gruen",
      grund: { code: "health", werte: { text: "HTTP 200" } },
    });
    u.melden("s1", [{ dienstId: id, aktiv: "inactive", health: "unbekannt" }], T + MIN);
    expect(dienstLesen(u.db, "b1", id, T + MIN)?.innenStand).toMatchObject({
      bewertung: "gelb",
      grund: { code: "unit", werte: { unit: "kontext.service", aktiv: "inactive" } },
    });
    u.melden("s1", [{ dienstId: id, aktiv: "inactive", health: "rot" }], T + 2 * MIN);
    expect(dienstLesen(u.db, "b1", id, T + 2 * MIN)?.innenStand).toMatchObject({
      bewertung: "rot",
      grund: { code: "health" },
    });
    u.melden("s1", [{ dienstId: id, aktiv: "unknown", health: "unbekannt" }], T + 3 * MIN);
    expect(dienstLesen(u.db, "b1", id, T + 3 * MIN)?.innenStand).toMatchObject({
      bewertung: "unbekannt",
    });
    // no report for 90 s after a green one: unknown, never the last green
    u.melden("s1", [{ dienstId: id }], T + 4 * MIN);
    expect(dienstLesen(u.db, "b1", id, T + 4 * MIN + 90_000)?.innenStand).toMatchObject({
      bewertung: "unbekannt",
      grund: { code: "keine_meldung" },
    });
  });

  it("decide by the units alone without a check, and never green with a unit unknown", () => {
    const u = umgebung();
    const id = u.anlegen("b1", { ...KONTEXT, health: { art: "keine" } });
    u.melden("s1", [{ dienstId: id, health: "unbekannt" }], T);
    expect(dienstLesen(u.db, "b1", id, T)?.innenStand).toMatchObject({
      bewertung: "gruen",
      grund: { code: "nur_units" },
    });
    u.melden("s1", [{ dienstId: id, aktiv: "unknown", health: "unbekannt" }], T + MIN);
    expect(dienstLesen(u.db, "b1", id, T + MIN)?.innenStand?.bewertung).toBe("unbekannt");
  });

  it("never rate green a report that leaves out a unit the service names", () => {
    const u = umgebung();
    const id = u.anlegen("b1", {
      ...KONTEXT,
      units: ["kontext.service", "fehlt.service"],
      health: { art: "keine" },
    });
    // a report made from the list before the change, or by an agent that leaves a unit out
    u.melden("s1", [{ dienstId: id, health: "unbekannt" }], T);
    expect(dienstLesen(u.db, "b1", id, T)?.innenStand).toMatchObject({
      bewertung: "unbekannt",
      grund: { code: "unit", werte: { unit: "fehlt.service", aktiv: "unknown" } },
    });
  });

  it("forget the rating once the operator changes what is read", () => {
    const u = umgebung();
    const id = u.anlegen("b1", { ...KONTEXT, health: { art: "keine" } });
    u.melden("s1", [{ dienstId: id, health: "unbekannt" }], T);
    expect(dienstLesen(u.db, "b1", id, T)?.innenStand?.bewertung).toBe("gruen");
    const kontext = { betreiberId: "b1", akteur: "n", jetzt: T + 1000, grund: "Dienst geändert" };
    const daten = { name: "Kontext", host: "kontext.teufel-it.de", pfad: "/", kundeId: null };
    // other units, then another server: the green of what was read before says nothing of them
    const innen: Innen = { ...KONTEXT, units: ["fehlt.service"], health: { art: "keine" } };
    expect(dienstAendern(u.db, u.schreibDb, kontext, id, { ...daten, innen }).ok).toBe(true);
    expect(dienstLesen(u.db, "b1", id, T + 1000)?.innenStand).toMatchObject({
      bewertung: "unbekannt",
      grund: { code: "noch_keine_meldung" },
    });
    const zurueck: Innen = { ...innen, units: ["kontext.service"] };
    expect(dienstAendern(u.db, u.schreibDb, kontext, id, { ...daten, innen: zurueck }).ok).toBe(
      true,
    );
    u.melden("s1", [{ dienstId: id, health: "unbekannt" }], T + 2000);
    expect(dienstLesen(u.db, "b1", id, T + 2000)?.innenStand?.bewertung).toBe("gruen");
    const umzug: Innen = { ...zurueck, serverId: "s2" };
    expect(dienstAendern(u.db, u.schreibDb, kontext, id, { ...daten, innen: umzug }).ok).toBe(true);
    expect(dienstLesen(u.db, "b1", id, T + 3000)?.innenStand?.bewertung).toBe("unbekannt");
    // a change of the name alone keeps the rating
    u.melden("s2", [{ dienstId: id, health: "unbekannt" }], T + 4000);
    const name = { ...daten, name: "Kontext 2", innen: umzug };
    expect(dienstAendern(u.db, u.schreibDb, kontext, id, name).ok).toBe(true);
    expect(dienstLesen(u.db, "b1", id, T + 5000)?.innenStand?.bewertung).toBe("gruen");
  });

  it("reach only services of this server and operator; any other is dropped and logged", () => {
    const u = umgebung();
    const hier = u.anlegen("b1", KONTEXT);
    const anderer = u.anlegen("b1", { ...KONTEXT, serverId: "s2" });
    const nurAussen = u.anlegen("b1", null);
    const fremd = u.anlegen("b2", { ...KONTEXT, serverId: "p1" });
    u.melden(
      "s1",
      [hier, anderer, nurAussen, fremd, "erfunden"].map((dienstId) => ({ dienstId })),
      T,
    );
    expect(
      u.db
        .select()
        .from(dienstInnen)
        .all()
        .map((z) => z.dienstId),
    ).toEqual([hier]);
    expect(u.zeilen.map((z) => JSON.parse(z).dienstId)).toEqual([
      anderer,
      nurAussen,
      fremd,
      "erfunden",
    ]);
  });

  it("make a fault after five minutes red inside, fixed once inside and outside are green", () => {
    const u = umgebung();
    const id = u.anlegen("b1", KONTEXT);
    for (let t = T; t <= T + STOERUNG_NACH_MS; t += MIN / 2)
      u.melden("s1", [{ dienstId: id, aktiv: "failed", health: "rot" }], t);
    expect(u.stoerungen()).toEqual([
      [
        "stoerung",
        "Störung Kontext: seit 5 Min. innen rot; Health: keine Verbindung zu 127.0.0.1:3000",
      ],
    ]);
    // inside green again, but outside red: the fault stays open
    const zeile = dienstZeileLesen(u.db, "b1", id);
    if (!zeile) throw new Error("no service");
    const rot = { dns: { ok: false as const, fehler: "NXDOMAIN" }, tls: null, http: null };
    dienstErgebnisAnnehmen(u.deps, zeile, rot as never, T + 6 * MIN);
    u.melden("s1", [{ dienstId: id }], T + 6 * MIN);
    expect(u.stoerungen()).toHaveLength(1);
    const gut = {
      dns: { ok: true, a: ["203.0.113.10"], aaaa: [] },
      tls: { ok: true, gueltigBis: T + 60 * 86_400_000 },
      http: { ok: true, status: 200, ms: 40 },
    };
    dienstErgebnisAnnehmen(u.deps, zeile, gut as never, T + 7 * MIN);
    expect(u.stoerungen().at(-1)).toEqual([
      "stoerung_behoben",
      "Störung Kontext behoben: wieder grün",
    ]);
  });
});

describe("the list for an agent", () => {
  it("names only the server's services not removed, of its own operator", () => {
    const u = umgebung();
    const hier = u.anlegen("b1", KONTEXT);
    u.anlegen("b1", { ...KONTEXT, serverId: "s2" });
    u.anlegen("b1", null);
    expect(JSON.parse(beobachtenNachricht(u.db, "b1", "s1"))).toEqual({
      typ: "beobachten",
      protokoll: 1,
      dienste: [
        {
          dienstId: hier,
          ...{ nutzer: "tristan", units: ["kontext.service"] },
          health: KONTEXT.health,
        },
      ],
    });
    expect(JSON.parse(beobachtenNachricht(u.db, "b2", "s1")).dienste).toEqual([]);
  });

  it("stays a message the agent takes: a server takes no more services than the protocol", () => {
    const u = umgebung();
    for (let i = 0; i < BEOBACHTET_MAX; i++) u.anlegen("b1", KONTEXT, `Dienst ${i}`);
    const kontext = { betreiberId: "b1", akteur: "n", jetzt: T, grund: "Dienst angelegt" };
    const daten = { name: "zu viel", host: "kontext.teufel-it.de", pfad: "/", kundeId: null };
    expect(dienstAnlegen(u.db, u.schreibDb, kontext, { ...daten, innen: KONTEXT })).toEqual({
      ok: false,
      grund: "server_voll",
    });
    expect(JSON.parse(beobachtenNachricht(u.db, "b1", "s1")).dienste).toHaveLength(BEOBACHTET_MAX);
    // one of them may still be changed, and another server takes the next
    const woanders = { ...daten, innen: { ...KONTEXT, serverId: "s2" } };
    expect(dienstAnlegen(u.db, u.schreibDb, kontext, woanders).ok).toBe(true);
    const einer = JSON.parse(beobachtenNachricht(u.db, "b1", "s1")).dienste[0].dienstId;
    const anders = { ...daten, innen: { ...KONTEXT, nutzer: null } };
    expect(dienstAendern(u.db, u.schreibDb, kontext, einer, anders).ok).toBe(true);
  });
});

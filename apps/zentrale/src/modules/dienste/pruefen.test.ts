import type { Probe } from "@steuerzentrale/planung";
import { STOERUNG_NACH_MS } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import {
  auditLog,
  auftraege,
  dienstPruefungen,
  dienstVerfuegbarkeit,
  ereignisse,
  zustellungen,
} from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { betreiberAnlegen } from "../../testhilfen/bewertung.ts";
import { schreiben } from "../audit/index.ts";
import { aufbewahren } from "../aufbewahrung/index.ts";
import { aussenPruefen } from "../aussen/index.ts";
import { zustellungenAnlegen } from "../benachrichtigung/zuordnen.ts";
import { dienstAnlegen, dienstEntfernen, diensteListe, dienstLesen } from "./dienste.ts";

/*
 * BAULISTE.md Z-1101: an observed service is checked from outside every minute like an
 * installation (Z-704): the same events after the second red check, the same fault after five
 * minutes, the same hourly counts for the availability; never a job for an agent. The network is
 * a fake sonde: whatever the test says a host answers.
 */

const T = Date.UTC(2026, 10, 23, 12);
const MIN = 60_000;

const gut: Probe = {
  dns: { ok: true, a: ["203.0.113.10"], aaaa: [] },
  tls: { ok: true, gueltigBis: T + 60 * 86_400_000 },
  http: { ok: true, status: 200, ms: 40 },
};
const mitStatus = (status: number): Probe => ({ ...gut, http: { ok: true, status, ms: 12 } });

const umgebung = () => {
  const offen = testDatenbank();
  betreiberAnlegen(offen.schreibDb, "b1", []);
  betreiberAnlegen(offen.schreibDb, "b2", []);
  const uhr = { ms: T };
  const antworten = new Map<string, Probe>();
  const gefragt: string[] = [];
  const deps = {
    db: offen.db,
    schreibDb: offen.schreibDb,
    now: () => uhr.ms,
    log: () => {},
    sonde: async (host: string, pfad: string) => {
      gefragt.push(`${host}${pfad}`);
      return antworten.get(host) ?? gut;
    },
  };
  const anlegen = (betreiberId: string, name: string, host: string, pfad = "/") => {
    const kontext = { betreiberId, akteur: "nutzer-1", jetzt: uhr.ms, grund: "Dienst angelegt" };
    const r = dienstAnlegen(offen.db, offen.schreibDb, kontext, {
      name,
      host,
      pfad,
      kundeId: null,
      innen: null,
    });
    if (!r.ok) throw new Error(r.grund);
    return r.dienst.id;
  };
  const laufen = async (von: number, bis: number) => {
    for (let t = von; t < bis; t += MIN) {
      uhr.ms = t;
      await aussenPruefen(deps);
    }
  };
  const arten = (id: string) =>
    offen.db
      .select()
      .from(ereignisse)
      .all()
      .filter((e) => e.ziel === `dienst:${id}`)
      .map((e) => [e.zeitpunkt, e.art, e.schwere]);
  return { ...offen, uhr, antworten, gefragt, deps, anlegen, laufen, arten };
};

describe("an observed service, checked from outside", () => {
  it("turns green against a good answer and asks its health path", async () => {
    const u = umgebung();
    const id = u.anlegen("b1", "Wiki", "wiki.teufel-it.de", "/health");
    await u.laufen(T, T + MIN);
    expect(u.gefragt).toEqual(["wiki.teufel-it.de/health"]);
    expect(dienstLesen(u.db, "b1", id, T)?.aussen).toMatchObject({
      zustand: "gruen",
      grund: { code: "erreichbar" },
    });
  });

  it.each([
    [200, "gruen"],
    [302, "gruen"],
    [399, "gruen"],
    [401, "rot"],
    [404, "rot"],
    [503, "rot"],
  ])("rates HTTP %i as %s, as an installation's health path", async (status, zustand) => {
    const u = umgebung();
    const id = u.anlegen("b1", "Wiki", "wiki.teufel-it.de");
    u.antworten.set("wiki.teufel-it.de", mitStatus(status));
    await u.laufen(T, T + MIN);
    expect(dienstLesen(u.db, "b1", id, T)?.aussen?.zustand).toBe(zustand);
  });

  it("writes `aussen_rot` after the second red check, a fault after five minutes, and their ends", async () => {
    const u = umgebung();
    const id = u.anlegen("b1", "Wiki", "wiki.teufel-it.de");
    u.antworten.set("wiki.teufel-it.de", mitStatus(503));
    await u.laufen(T, T + STOERUNG_NACH_MS + MIN);
    u.antworten.delete("wiki.teufel-it.de");
    await u.laufen(T + 10 * MIN, T + 12 * MIN);
    expect(u.arten(id)).toEqual([
      [T + MIN, "aussen_rot", "warn"],
      [T + STOERUNG_NACH_MS, "stoerung", "fehler"],
      [T + 10 * MIN, "aussen_gruen", "info"],
      [T + 10 * MIN, "stoerung_behoben", "info"],
    ]);
    const texte = u.db
      .select()
      .from(ereignisse)
      .all()
      .map((e) => e.text);
    expect(texte).toEqual([
      "Von außen rot: Wiki (wiki.teufel-it.de): Health: HTTP 503",
      "Störung Wiki: seit 5 Min. außen rot; Health: HTTP 503",
      "Von außen wieder grün: Wiki (wiki.teufel-it.de)",
      "Störung Wiki behoben: wieder grün",
    ]);
    const audit = u.db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.aktion.startsWith("ereignis."))
      .map((a) => [a.betreiberId, a.aktion, a.akteur]);
    expect(audit).toEqual([
      ["b1", "ereignis.aussen-rot", "system"],
      ["b1", "ereignis.stoerung", "system"],
      ["b1", "ereignis.aussen-gruen", "system"],
      ["b1", "ereignis.stoerung-behoben", "system"],
    ]);
  });

  it("counts every check into its hour for the availability", async () => {
    const u = umgebung();
    const id = u.anlegen("b1", "Wiki", "wiki.teufel-it.de");
    await u.laufen(T, T + 3 * MIN);
    u.antworten.set("wiki.teufel-it.de", mitStatus(503));
    await u.laufen(T + 3 * MIN, T + 4 * MIN);
    expect(u.db.select().from(dienstVerfuegbarkeit).all()).toEqual([
      { betreiberId: "b1", dienstId: id, stunde: T, gemessen: 4, rot: 1 },
    ]);
    const v = dienstLesen(u.db, "b1", id, T + 4 * MIN)?.verfuegbarkeit;
    expect(v).toMatchObject({ gemessen: 4, rot: 1, anteil: 0.75 });
  });

  it("never makes a job for an agent", async () => {
    const u = umgebung();
    u.anlegen("b1", "Wiki", "wiki.teufel-it.de");
    u.antworten.set("wiki.teufel-it.de", mitStatus(503));
    await u.laufen(T, T + 10 * MIN);
    expect(u.db.select().from(auftraege).all()).toEqual([]);
  });

  it("sends its events to the recipients like any other", async () => {
    const u = umgebung();
    schreiben(u.schreibDb, { betreiberId: "b1", akteur: "t", jetzt: 1, grund: "t" }, "t", (w) =>
      w.einfuegen("empfaenger", {
        betreiberId: "b1",
        empfaengerId: "e1",
        art: "webhook",
        anzeige: "Bereitschaft",
        geheim: null,
        abSchwere: "fehler",
        angelegtAm: 1,
      }),
    );
    const id = u.anlegen("b1", "Wiki", "wiki.teufel-it.de");
    u.antworten.set("wiki.teufel-it.de", mitStatus(503));
    await u.laufen(T, T + STOERUNG_NACH_MS + MIN);
    zustellungenAnlegen(u.db, u.schreibDb, T + 6 * MIN);
    const stoerung = u.db
      .select()
      .from(ereignisse)
      .all()
      .find((e) => e.ziel === `dienst:${id}` && e.art === "stoerung");
    expect(u.db.select().from(zustellungen).all()).toEqual([
      expect.objectContaining({ ereignisId: stoerung?.ereignisId, empfaengerId: "e1" }),
    ]);
  });

  it("is no longer checked or listed once removed; its measurements stay until the retention", async () => {
    const u = umgebung();
    const id = u.anlegen("b1", "Wiki", "wiki.teufel-it.de");
    await u.laufen(T, T + MIN);
    const r = dienstEntfernen(
      u.db,
      u.schreibDb,
      {
        betreiberId: "b1",
        akteur: "nutzer-1",
        jetzt: T + MIN,
        grund: "Dienst entfernt",
      },
      id,
    );
    expect(r.ok).toBe(true);
    u.gefragt.length = 0;
    await u.laufen(T + 2 * MIN, T + 5 * MIN);
    expect(u.gefragt).toEqual([]);
    expect(diensteListe(u.db, "b1", T + 5 * MIN)).toEqual([]);
    expect(u.db.select().from(dienstPruefungen).all()).toHaveLength(1);
    expect(u.db.select().from(dienstVerfuegbarkeit).all()).toHaveLength(1);
    aufbewahren(u.db, u.schreibDb, T + 400 * 86_400_000);
    expect(u.db.select().from(dienstVerfuegbarkeit).all()).toEqual([]);
  });

  it("checks each operator's services within that operator", async () => {
    const u = umgebung();
    const a = u.anlegen("b1", "Wiki", "wiki.teufel-it.de");
    const b = u.anlegen("b2", "Shop", "shop.partner.example");
    u.antworten.set("shop.partner.example", mitStatus(503));
    await u.laufen(T, T + 2 * MIN);
    expect(diensteListe(u.db, "b1", T + 2 * MIN).map((d) => [d.id, d.aussen?.zustand])).toEqual([
      [a, "gruen"],
    ]);
    expect(diensteListe(u.db, "b2", T + 2 * MIN).map((d) => [d.id, d.aussen?.zustand])).toEqual([
      [b, "rot"],
    ]);
    expect(dienstLesen(u.db, "b1", b, T)).toBeUndefined();
    const ziele = u.db
      .select()
      .from(ereignisse)
      .all()
      .map((e) => [e.betreiberId, e.ziel]);
    expect(ziele).toEqual([["b2", `dienst:${b}`]]);
  });
});

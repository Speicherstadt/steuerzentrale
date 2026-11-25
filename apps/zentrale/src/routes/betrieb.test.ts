import { describe, expect, it } from "vitest";
import {
  alleSeiten,
  auftragEinfuegen,
  ereignisEinfuegen,
  serverEinfuegen,
} from "../testhilfen/betrieb.ts";
import { testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-406: jobs, events and the audit log page by page, every row exactly once, also when
 * new rows come between two pages; the audit log for both roles (Z-1204); a manifest's text and
 * signature stay "[ausgelassen]".
 */

const mitInhaber = async () => {
  const server = testServer();
  const inhaber = await server.inhaber();
  return { server, inhaber };
};

const ids = (zeilen: Record<string, unknown>[], feld: string) => zeilen.map((z) => String(z[feld]));

describe("GET /api/v1/ereignisse", () => {
  it("gives every event exactly once, newest first, while new ones arrive", async () => {
    const { server, inhaber } = await mitInhaber();
    // seven events, two in the same millisecond: the id keeps their order
    for (const zeitpunkt of [10, 20, 20, 30, 40, 50, 60])
      ereignisEinfuegen(server.schreibDb, inhaber.betreiberId, { zeitpunkt });
    const alle = (
      (await inhaber.json("/api/v1/ereignisse?anzahl=200")).daten as {
        eintraege: { ereignisId: string; zeitpunkt: number }[];
      }
    ).eintraege;
    expect(alle.map((e) => e.zeitpunkt)).toEqual([60, 50, 40, 30, 20, 20, 10]);

    const gelesen = await alleSeiten(inhaber, "/api/v1/ereignisse", 3, () => {
      ereignisEinfuegen(server.schreibDb, inhaber.betreiberId, { zeitpunkt: 100 });
      ereignisEinfuegen(server.schreibDb, inhaber.betreiberId, { zeitpunkt: 20 });
    });
    const gelesenIds = ids(gelesen, "ereignisId");
    expect(new Set(gelesenIds).size).toBe(gelesenIds.length);
    for (const e of alle) expect(gelesenIds).toContain(e.ereignisId);
  });

  it("narrows by severity, kind and target", async () => {
    const { server, inhaber } = await mitInhaber();
    const b = inhaber.betreiberId;
    ereignisEinfuegen(server.schreibDb, b, { zeitpunkt: 1, schwere: "warn", ziel: "server:s1" });
    ereignisEinfuegen(server.schreibDb, b, { zeitpunkt: 2, schwere: "fehler", art: "stoerung" });
    ereignisEinfuegen(server.schreibDb, b, { zeitpunkt: 3, schwere: "info", ziel: "server:s2" });
    const lesen = async (q: string) =>
      (
        (await inhaber.json(`/api/v1/ereignisse?${q}`)).daten as {
          eintraege: { zeitpunkt: number }[];
        }
      ).eintraege.map((e) => e.zeitpunkt);
    expect(await lesen("schwere=warn&schwere=fehler")).toEqual([2, 1]);
    expect(await lesen("art=stoerung")).toEqual([2]);
    expect(await lesen("ziel=server:s2")).toEqual([3]);
  });

  it("refuses a cursor it did not hand out and a size out of range", async () => {
    const { inhaber } = await mitInhaber();
    for (const q of ["weiter=kaputt", "anzahl=0", "anzahl=201", "anzahl=zwei"])
      expect((await inhaber.json(`/api/v1/ereignisse?${q}`)).status, q).toBe(400);
  });
});

describe("GET /api/v1/auftraege", () => {
  it("gives every job exactly once while new ones arrive, without manifest or signature", async () => {
    const { server, inhaber } = await mitInhaber();
    const b = inhaber.betreiberId;
    serverEinfuegen(server.schreibDb, b, "s1", { name: "Gemeinsamer Server 1" });
    for (const angelegtAm of [10, 20, 20, 30, 40, 50, 60])
      auftragEinfuegen(server.schreibDb, b, "s1", { angelegtAm });
    const vorher = (
      (await inhaber.json("/api/v1/auftraege?anzahl=200")).daten as {
        eintraege: Record<string, unknown>[];
      }
    ).eintraege;
    expect(vorher.map((a) => a.angelegtAm)).toEqual([60, 50, 40, 30, 20, 20, 10]);
    expect(vorher[0]).toMatchObject({ server: { serverId: "s1", name: "Gemeinsamer Server 1" } });
    expect(JSON.stringify(vorher)).not.toMatch(/schema: 1|untrusted comment|argumente/);

    const gelesen = await alleSeiten(inhaber, "/api/v1/auftraege", 2, () => {
      auftragEinfuegen(server.schreibDb, b, "s1", { angelegtAm: 100 });
      auftragEinfuegen(server.schreibDb, b, "s1", { angelegtAm: 15 });
    });
    const gelesenIds = ids(gelesen, "auftragId");
    expect(new Set(gelesenIds).size).toBe(gelesenIds.length);
    for (const a of vorher) expect(gelesenIds).toContain(a.auftragId);
  });

  it("narrows by state and server, and names a failed job's reason", async () => {
    const { server, inhaber } = await mitInhaber();
    const b = inhaber.betreiberId;
    serverEinfuegen(server.schreibDb, b, "s1");
    serverEinfuegen(server.schreibDb, b, "s2");
    auftragEinfuegen(server.schreibDb, b, "s1", { angelegtAm: 1, zustand: "gescheitert" });
    auftragEinfuegen(server.schreibDb, b, "s2", { angelegtAm: 2 });
    const { daten } = await inhaber.json("/api/v1/auftraege?zustand=gescheitert");
    expect((daten as { eintraege: unknown[] }).eintraege).toEqual([
      expect.objectContaining({ zustand: "gescheitert", fehler: "kaputt" }),
    ]);
    const s2 = await inhaber.json("/api/v1/auftraege?serverId=s2");
    expect((s2.daten as { eintraege: unknown[] }).eintraege).toEqual([
      expect.objectContaining({ server: { serverId: "s2", name: "s2" }, fehler: null }),
    ]);
  });
});

describe("GET /api/v1/audit", () => {
  it("gives every entry exactly once while new ones arrive", async () => {
    const { server, inhaber } = await mitInhaber();
    for (let n = 0; n < 5; n += 1)
      ereignisEinfuegen(server.schreibDb, inhaber.betreiberId, { zeitpunkt: n });
    const vorher = ids(
      ((await inhaber.json("/api/v1/audit?anzahl=200")).daten as { eintraege: never[] }).eintraege,
      "nummer",
    );
    expect(vorher.length).toBeGreaterThan(5);
    const gelesen = ids(
      await alleSeiten(inhaber, "/api/v1/audit", 2, () =>
        ereignisEinfuegen(server.schreibDb, inhaber.betreiberId, { zeitpunkt: 99 }),
      ),
      "nummer",
    );
    expect(new Set(gelesen).size).toBe(gelesen.length);
    for (const nummer of vorher) expect(gelesen).toContain(nummer);
  });

  it("shows a job's manifest and signature only as left out, and names the person", async () => {
    const { server, inhaber } = await mitInhaber();
    serverEinfuegen(server.schreibDb, inhaber.betreiberId, "s1");
    auftragEinfuegen(server.schreibDb, inhaber.betreiberId, "s1", { angelegtAm: 5 });
    const { daten } = await inhaber.json("/api/v1/audit?aktion=test.auftrag");
    const [eintrag] = (daten as { eintraege: { inhalt: { zeile: Record<string, unknown> } }[] })
      .eintraege;
    expect(eintrag?.inhalt.zeile).toMatchObject({
      manifest: "[ausgelassen]",
      signatur: "[ausgelassen]",
      aktion: "migrieren",
    });
    const erster = await inhaber.json(`/api/v1/audit?akteur=${inhaber.nutzerId}`);
    expect((erster.daten as { eintraege: { akteur: unknown }[] }).eintraege[0]?.akteur).toEqual({
      art: "person",
      id: inhaber.nutzerId,
      name: "Ines Inhaber",
    });
  });

  it("is read by both roles: a member sees everything (Z-1204)", async () => {
    const { server, inhaber } = await mitInhaber();
    const mitglied = await server.eingeladen(inhaber, "mitglied");
    expect((await inhaber.json("/api/v1/audit")).status).toBe(200);
    expect((await mitglied.json("/api/v1/audit")).status).toBe(200);
    for (const pfad of ["/api/v1/uebersicht", "/api/v1/auftraege", "/api/v1/ereignisse"])
      expect((await mitglied.json(pfad)).status, pfad).toBe(200);
  });
});

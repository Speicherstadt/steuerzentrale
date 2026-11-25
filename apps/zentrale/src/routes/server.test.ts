import { describe, expect, it } from "vitest";
import { VOM_AGENTEN_V1 } from "../../../../packages/protokoll/src/beispiele-v1.ts";
import { auditLog, server as serverTabelle, tokens } from "../db/schema.ts";
import { faktenAnfuegen } from "../modules/audit/index.ts";
import { BEITRITT_GUELTIG_MS } from "../modules/server/index.ts";
import { NEUER_SERVER, serverHinzufuegen, testAnfrage } from "../testhilfen/agent.ts";
import { TEST_AGENT_URL, testServer } from "../testhilfen/server.ts";

// BAULISTE.md Z-302: adding a server makes a one-time token, valid 24 hours, kept only as a hash
describe("adding a server", () => {
  it("answers the install command with a one-time token once, keeping only its hash", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId, befehl, token, gueltigBis } = await serverHinzufuegen(inhaber);
    expect(befehl).toBe(`curl -fsSL ${TEST_AGENT_URL}/install.sh | sudo sh -s -- --token ${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gueltigBis).toBe(server.jetzt() + BEITRITT_GUELTIG_MS);
    expect(server.db.select().from(serverTabelle).all()).toEqual([
      expect.objectContaining({
        betreiberId: inhaber.betreiberId,
        serverId,
        name: NEUER_SERVER.name,
        fingerabdruck: null,
        wartungsfenster: JSON.stringify(NEUER_SERVER.wartungsfenster),
        angelegtVon: inhaber.nutzerId,
      }),
    ]);
    const gespeichert = JSON.stringify([
      server.db.select().from(tokens).all(),
      server.db.select().from(serverTabelle).all(),
      server.db.select().from(auditLog).all(),
    ]);
    expect(gespeichert).not.toContain(token);
  });

  it("writes the audit log with the reason", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId } = await serverHinzufuegen(inhaber);
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "server.anlegen");
    expect(eintraege.map((e) => e.ziel)).toEqual([`server:${serverId}`, `tokens:${serverId}`]);
    expect(
      eintraege.every((e) => e.grund === "neuer Server" && e.akteur === inhaber.nutzerId),
    ).toBe(true);
  });

  it("asks no kind and no customer: every server is the operator's own (Z-1205)", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    for (const extra of [
      { art: "gemeinsam" },
      { art: "eigen", kundeId: "k1" },
      { kundeId: "k1" },
    ]) {
      const { status } = await inhaber.json("/api/v1/server", {
        body: { ...NEUER_SERVER, ...extra },
      });
      expect(status, JSON.stringify(extra)).toBe(400);
    }
    const { serverId } = await serverHinzufuegen(inhaber);
    const { daten } = await inhaber.json(`/api/v1/server/${serverId}`);
    expect(daten).not.toHaveProperty("art");
    expect(daten).not.toHaveProperty("kundeId");
  });

  it("is added without a reason, with an empty one in the audit log (Z-1207)", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { grund: _, ...ohneGrund } = NEUER_SERVER;
    const { status, daten } = await inhaber.json("/api/v1/server", { body: ohneGrund });
    expect(status).toBe(201);
    expect(server.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({
        aktion: "server.anlegen",
        ziel: `server:${(daten as { serverId: string }).serverId}`,
        grund: "",
      }),
    );
  });

  it.each([
    ["no name", { name: " " }],
    ["a time that is none", { wartungsfenster: { tage: [1], von: "24:00", bis: "01:00" } }],
    ["no weekday", { wartungsfenster: { tage: [], von: "03:30", bis: "04:30" } }],
    ["a weekday twice", { wartungsfenster: { tage: [1, 1], von: "03:30", bis: "04:30" } }],
    ["an unknown field", { port: 22 }],
  ])("refuses %s", async (_fall, aenderung) => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { status, daten } = await inhaber.json("/api/v1/server", {
      body: { ...NEUER_SERVER, ...aenderung },
    });
    expect({ status, daten }).toEqual({ status: 400, daten: { fehler: "ungueltig" } });
    expect(server.db.select().from(serverTabelle).all()).toEqual([]);
  });
});

// BAULISTE.md Z-303: the servers with the state of their agents, and revoking a certificate
describe("the servers of the operator", () => {
  it("lists them with what the agent reported and the state of its connection, never its certificate", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId } = await serverHinzufuegen(inhaber);
    const { status, daten } = await inhaber.json("/api/v1/server");
    expect(status).toBe(200);
    expect(daten).toEqual({
      server: [
        {
          serverId,
          name: NEUER_SERVER.name,
          wartungsfenster: NEUER_SERVER.wartungsfenster,
          angelegtAm: server.jetzt(),
          beigetretenAm: null,
          architektur: null,
          agentVersion: null,
          zertifikatGueltigBis: null,
          gesperrtAm: null,
          agent: { zustand: "getrennt", letzterHeartbeat: null },
          fakten: null,
          faktenAm: null,
          // Z-701: without facts nobody knows whether it needs a reboot
          neustart: { noetig: null, plan: { art: "warten", grund: "unbekannt" }, letzter: null },
        },
      ],
    });
    // its own page has its checks besides (Z-702): unknown without facts, the backups green
    expect((await inhaber.json(`/api/v1/server/${serverId}`)).daten).toEqual({
      ...(daten as { server: object[] }).server[0],
      pruefungen: [
        { pruefung: "platte", ergebnis: "unbekannt", platten: null, seit: null },
        { pruefung: "zertifikate", ergebnis: "unbekannt", zertifikate: null, seit: null },
        { pruefung: "backups", ergebnis: "gruen", alt: [], seit: null },
        { pruefung: "ports", ergebnis: "unbekannt", fremd: null, seit: null },
        {
          pruefung: "uhrzeit",
          ergebnis: "unbekannt",
          abweichungMs: null,
          synchron: null,
          seit: null,
        },
        { pruefung: "arbeitsspeicher", ergebnis: "unbekannt", prozent: null, seit: null },
      ],
    });
    expect((await inhaber.json("/api/v1/server/gibt-es-nicht")).status).toBe(404);
  });

  // Z-304: the newest facts the agent reported, with the instant they came
  it("show the newest facts of each server", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId } = await serverHinzufuegen(inhaber);
    const nachricht = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") as Record<string, unknown>;
    faktenAnfuegen(server.deps.schreibDb, {
      betreiberId: inhaber.betreiberId,
      serverId,
      zeitpunkt: server.jetzt(),
      daten: JSON.stringify(nachricht),
    });
    const { typ: _typ, protokoll: _protokoll, ...werte } = nachricht;
    const { daten } = await inhaber.json(`/api/v1/server/${serverId}`);
    expect(daten).toMatchObject({ fakten: werte, faktenAm: server.jetzt() });
    const liste = (await inhaber.json("/api/v1/server")).daten as { server: unknown[] };
    expect(liste.server[0]).toMatchObject({ fakten: werte });
  });

  // Z-702: the checks of the server from its facts, only for its own operator
  it("show the checks of a server on its page, to its operator only", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
    const { serverId, token } = await serverHinzufuegen(inhaber);
    const beitritt = await server
      .browser()
      .json("/api/v1/agent/beitreten", { body: await testAnfrage(token) });
    expect(beitritt.status).toBe(201);
    const nachricht = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") as Record<string, unknown>;
    faktenAnfuegen(server.deps.schreibDb, {
      betreiberId: inhaber.betreiberId,
      serverId,
      zeitpunkt: server.jetzt(),
      daten: JSON.stringify({
        ...nachricht,
        platten: [{ mount: "/", gesamtMb: 1000, freiMb: 100 }],
        portsOffen: [{ port: 8080, proto: "tcp" }],
      }),
    });
    const { daten } = await inhaber.json(`/api/v1/server/${serverId}`);
    expect((daten as { pruefungen: unknown[] }).pruefungen).toEqual([
      { pruefung: "platte", ergebnis: "gelb", platten: [{ mount: "/", prozent: 90 }], seit: null },
      { pruefung: "zertifikate", ergebnis: "gruen", zertifikate: [], seit: null },
      { pruefung: "backups", ergebnis: "gruen", alt: [], seit: null },
      { pruefung: "ports", ergebnis: "gelb", fremd: [{ port: 8080, proto: "tcp" }], seit: null },
      { pruefung: "uhrzeit", ergebnis: "gruen", abweichungMs: 12, synchron: true, seit: null },
      { pruefung: "arbeitsspeicher", ergebnis: "unbekannt", prozent: null, seit: null },
    ]);
    expect((await partner.json(`/api/v1/server/${serverId}`)).status).toBe(404);
    const fremd = (await partner.json("/api/v1/uebersicht")).daten as { eintraege: unknown[] };
    expect(JSON.stringify(fremd)).not.toContain(serverId);
    const eigen = (await inhaber.json("/api/v1/uebersicht")).daten as { eintraege: unknown[] };
    expect(eigen.eintraege).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ art: "pruefung", verweis: { art: "server", id: serverId } }),
      ]),
    );
  });

  it("are revoked once, with a reason, and a revoked server cannot join with its token", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId, token } = await serverHinzufuegen(inhaber);
    const pfad = `/api/v1/server/${serverId}/sperren`;
    // Z-1207: without a reason, with an empty one in the audit log
    expect((await inhaber.json(pfad, { body: {} })).status).toBe(200);
    expect(server.db.select().from(auditLog).all().at(-1)).toMatchObject({
      aktion: "server.sperren",
      grund: "",
    });
    expect(await inhaber.json(pfad, { body: { grund: "noch mal" } })).toEqual({
      status: 409,
      daten: { fehler: "schon_gesperrt" },
    });
    expect(server.db.select().from(tokens).all()).toEqual([]);
    const beitritt = await server
      .browser()
      .json("/api/v1/agent/beitreten", { body: await testAnfrage(token) });
    expect(beitritt.status).toBe(401);
  });

  it("are revoked by owner and technician, not by mitglied", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const inhaber2 = await server.eingeladen(inhaber, "inhaber");
    const mitglied = await server.eingeladen(inhaber, "mitglied");
    const { serverId } = await serverHinzufuegen(inhaber);
    const pfad = `/api/v1/server/${serverId}/sperren`;
    expect((await mitglied.json(pfad, { body: { grund: "x" } })).status).toBe(403);
    expect((await mitglied.json("/api/v1/server")).status).toBe(200);
    expect((await inhaber2.json(pfad, { body: { grund: "x" } })).status).toBe(200);
  });
});

type Stunden = { stunden: { stunde: number; platten: { mount: string; prozent: number }[] }[] };

// The tab "Auslastung" of a server's page: how full its disks were, per hour from its facts
describe("GET /api/v1/server/:serverId/platten", () => {
  const STUNDE = 3_600_000;
  const nachricht = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") as Record<string, unknown>;
  const melden = (
    server: ReturnType<typeof testServer>,
    betreiberId: string,
    serverId: string,
    zeitpunkt: number,
    freiMb: number,
  ) =>
    faktenAnfuegen(server.deps.schreibDb, {
      betreiberId,
      serverId,
      zeitpunkt,
      daten: JSON.stringify({ ...nachricht, platten: [{ mount: "/", gesamtMb: 1000, freiMb }] }),
    });

  it("gives the fullest reading of each hour of the last 30 days, oldest first", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId } = await serverHinzufuegen(inhaber);
    const jetzt = server.jetzt();
    melden(server, inhaber.betreiberId, serverId, jetzt - 31 * 24 * STUNDE, 900);
    melden(server, inhaber.betreiberId, serverId, jetzt - 2 * STUNDE, 600);
    melden(server, inhaber.betreiberId, serverId, jetzt, 500);
    const { status, daten } = await inhaber.json(`/api/v1/server/${serverId}/platten`);
    expect(status).toBe(200);
    expect((daten as Stunden).stunden.map((s) => s.platten)).toEqual([
      [{ mount: "/", prozent: 40 }],
      [{ mount: "/", prozent: 50 }],
    ]);
    const tag = (await inhaber.json(`/api/v1/server/${serverId}/platten?tage=1`)).daten;
    expect((tag as Stunden).stunden).toHaveLength(2);
  });

  it("refuses a number of days that is not 1 to 30", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { serverId } = await serverHinzufuegen(inhaber);
    for (const tage of ["0", "31", "x", "-1", "1.5"])
      expect((await inhaber.json(`/api/v1/server/${serverId}/platten?tage=${tage}`)).status).toBe(
        400,
      );
  });

  it("shows no operator another's server or readings", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
    const { serverId } = await serverHinzufuegen(inhaber);
    const eigener = await serverHinzufuegen(partner);
    // a reading of the partner under the id of the owner's server, and the other way round
    melden(server, partner.betreiberId, serverId, server.jetzt(), 100);
    melden(server, inhaber.betreiberId, eigener.serverId, server.jetzt(), 100);
    melden(server, inhaber.betreiberId, serverId, server.jetzt(), 500);
    expect((await partner.json(`/api/v1/server/${serverId}/platten`)).status).toBe(404);
    const eigen = (await inhaber.json(`/api/v1/server/${serverId}/platten`)).daten as Stunden;
    expect(eigen.stunden.map((s) => s.platten)).toEqual([[{ mount: "/", prozent: 50 }]]);
    const fremd = (await partner.json(`/api/v1/server/${eigener.serverId}/platten`))
      .daten as Stunden;
    expect(fremd.stunden).toEqual([]);
  });

  it("is read by every role that reads the servers", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const mitglied = await server.eingeladen(inhaber, "mitglied");
    const { serverId } = await serverHinzufuegen(inhaber);
    expect((await mitglied.json(`/api/v1/server/${serverId}/platten`)).status).toBe(200);
  });
});

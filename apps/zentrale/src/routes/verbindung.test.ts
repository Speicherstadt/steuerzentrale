import { PROTOKOLL_VERSION, TRENNUNG, VERBINDUNG_PFAD } from "@steuerzentrale/protokoll";
import { afterEach, describe, expect, it } from "vitest";
import { auditLog, heartbeats, server as serverTabelle } from "../db/schema.ts";
import { FINGERABDRUCK_HEADER } from "../modules/verbindung/herkunft.ts";
import { serverHinzufuegen } from "../testhilfen/agent.ts";
import { zentraleStarten } from "../testhilfen/bun-server.ts";
import { testServer } from "../testhilfen/server.ts";
import { testPforte } from "../testhilfen/testpforte.ts";
import { agentAnfrage, agentBeitreten, fingerabdruckVon, pforteTls } from "../testhilfen/tls.ts";
import { testClient } from "../testhilfen/ws-client.ts";

/*
 * BAULISTE.md Z-303: the agent's connection over WSS with its client certificate. Between agent and
 * Zentrale stands a stand-in for the Pforte (testhilfen/testpforte.ts) that ends TLS, checks the
 * certificate and passes its fingerprint in the header to 127.0.0.1, the one way the Zentrale
 * learns which server is calling.
 */
const aufraeumen: (() => void)[] = [];
afterEach(() => {
  for (const f of aufraeumen.splice(0)) f();
});

const hallo = {
  typ: "hallo",
  protokoll: PROTOKOLL_VERSION,
  agentVersion: "0.0.1",
  architektur: "arm64",
  zeit: 1,
};

const aufgebaut = async () => {
  const server = testServer();
  // certificates are checked against the real clock by TLS: issue them now
  server.stelleUhr(Date.now());
  const inhaber = await server.inhaber();
  const neu = await serverHinzufuegen(inhaber);
  const agent = await agentBeitreten(server, neu.token);
  const bun = zentraleStarten(server.app);
  const tls = await pforteTls();
  const pforte = testPforte({ ziel: bun.port ?? 0, ...tls, clientCas: [agent.ca] });
  aufraeumen.push(
    () => pforte.stoppen(),
    () => bun.stop(true),
  );
  const url = `wss://127.0.0.1:${pforte.port}${VERBINDUNG_PFAD}`;
  const verbinden = (zertifikat = { cert: agent.zertifikat, key: agent.schluessel }) =>
    testClient(url, { ...zertifikat, ca: tls.ca });
  return { server, inhaber, agent, verbinden, bunPort: bun.port ?? 0 };
};

describe("the agent's connection", () => {
  it("says hallo with its certificate, gets willkommen, and its heartbeats land in heartbeats without audit", async () => {
    const { server, inhaber, agent, verbinden } = await aufgebaut();
    const client = verbinden();
    expect(await client.offen).toBe(true);
    client.senden(hallo);
    expect(await client.naechste()).toEqual({
      typ: "willkommen",
      protokoll: PROTOKOLL_VERSION,
      zeit: server.jetzt(),
      zertifikatGueltigBis: agent.gueltigBis,
    });
    const audit = server.db.select().from(auditLog).all().length;
    client.senden({ typ: "heartbeat", protokoll: PROTOKOLL_VERSION, zeit: 2 });
    await expect.poll(() => server.db.select().from(heartbeats).all().length).toBe(1);
    server.stelleUhr(server.jetzt() + 30_000);
    client.senden({ typ: "heartbeat", protokoll: PROTOKOLL_VERSION, zeit: 3 });
    await expect.poll(() => server.db.select().from(heartbeats).all().length).toBe(2);
    expect(server.db.select().from(heartbeats).all()[1]).toMatchObject({
      betreiberId: inhaber.betreiberId,
      serverId: agent.serverId,
      zeitpunkt: server.jetzt(),
    });
    expect(server.db.select().from(auditLog).all()).toHaveLength(audit);
    // what the agent reported at hallo is kept
    expect(server.db.select().from(serverTabelle).get()).toMatchObject({
      agentVersion: "0.0.1",
      architektur: "arm64",
    });
    const { daten } = await inhaber.json(`/api/v1/server/${agent.serverId}`);
    expect(daten).toMatchObject({
      agent: { zustand: "verbunden", letzterHeartbeat: server.jetzt() },
    });
    client.schliessen();
    await client.zu;
    await expect
      .poll(
        async () =>
          ((await inhaber.json("/api/v1/server")).daten as { server: { agent: unknown }[] })
            .server[0]?.agent,
      )
      .toEqual({ zustand: "getrennt", letzterHeartbeat: server.jetzt() });
  });

  it("is refused without a certificate, or with one the operator's CA did not issue", async () => {
    const { verbinden } = await aufgebaut();
    const ohne = verbinden({} as never);
    expect(await ohne.offen).toBe(false);
    const fremd = await pforteTls();
    const anderes = verbinden({ cert: fremd.zertifikat, key: fremd.schluessel });
    expect(await anderes.offen).toBe(false);
  });

  it("believes the fingerprint header only from the loopback address", async () => {
    const { server, agent } = await aufgebaut();
    const fingerabdruck = await fingerabdruckVon(agent.zertifikat);
    const von = async (adresse: string) =>
      (
        await server
          .browser(adresse)
          .anfrage(VERBINDUNG_PFAD, { headers: { [FINGERABDRUCK_HEADER]: fingerabdruck } })
      ).status;
    expect(await von("198.51.100.4")).toBe(401);
    // from the Pforte the header counts: without a WebSocket upgrade there is nothing more to do
    expect(await von("127.0.0.1")).toBe(426);
  });

  it("ends a connection that does not start with hallo, or sends what it cannot read", async () => {
    const { verbinden } = await aufgebaut();
    const ohneHallo = verbinden();
    await ohneHallo.offen;
    ohneHallo.senden({ typ: "heartbeat", protokoll: PROTOKOLL_VERSION, zeit: 1 });
    expect((await ohneHallo.zu).code).toBe(TRENNUNG.ungueltig);
    const unlesbar = verbinden();
    await unlesbar.offen;
    unlesbar.senden({ typ: "befehl", protokoll: PROTOKOLL_VERSION, argv: ["sh"] });
    expect((await unlesbar.zu).code).toBe(TRENNUNG.ungueltig);
  });

  it("keeps one connection per server: a newer one replaces the older", async () => {
    const { verbinden } = await aufgebaut();
    const erste = verbinden();
    await erste.offen;
    const zweite = verbinden();
    await zweite.offen;
    expect((await erste.zu).code).toBe(TRENNUNG.ersetzt);
    zweite.senden(hallo);
    expect(await zweite.naechste()).toMatchObject({ typ: "willkommen" });
  });
});

describe("a revoked certificate", () => {
  it("ends the running connection at once and is refused from then on", async () => {
    const { server, inhaber, agent, verbinden } = await aufgebaut();
    const client = verbinden();
    await client.offen;
    client.senden(hallo);
    await client.naechste();
    const { status, daten } = await inhaber.json(`/api/v1/server/${agent.serverId}/sperren`, {
      body: { grund: "Server gestohlen" },
    });
    expect(status).toBe(200);
    expect(daten).toMatchObject({ gesperrtAm: server.jetzt(), agent: { zustand: "getrennt" } });
    expect(await client.zu).toEqual({ code: TRENNUNG.gesperrt, grund: "certificate revoked" });
    const wieder = verbinden();
    expect(await wieder.offen).toBe(false);
    expect(server.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({
        aktion: "server.sperren",
        akteur: inhaber.nutzerId,
        ziel: `server:${agent.serverId}`,
        grund: "Server gestohlen",
      }),
    );
  });

  it("drops what the connection sends after it was revoked", async () => {
    const { server, inhaber, agent, verbinden } = await aufgebaut();
    const client = verbinden();
    await client.offen;
    client.senden(hallo);
    await client.naechste();
    await inhaber.json(`/api/v1/server/${agent.serverId}/sperren`, { body: { grund: "weg" } });
    client.senden({ typ: "heartbeat", protokoll: PROTOKOLL_VERSION, zeit: 9 });
    await client.zu;
    expect(server.db.select().from(heartbeats).all()).toEqual([]);
  });
});

describe("the request of an agent without a joined certificate", () => {
  it("cannot open a connection with a fresh key and no certificate of the CA", async () => {
    const { verbinden } = await aufgebaut();
    const { schluessel } = await agentAnfrage();
    const client = verbinden({ key: schluessel } as never);
    expect(await client.offen).toBe(false);
  });
});

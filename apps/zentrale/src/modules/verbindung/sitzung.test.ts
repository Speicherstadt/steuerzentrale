import * as x509 from "@peculiar/x509";
import { HEARTBEAT_MS, PROTOKOLL_VERSION, ROTIEREN_VOR_MS } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { auditLog, heartbeats, server as serverTabelle } from "../../db/schema.ts";
import { serverHinzufuegen } from "../../testhilfen/agent.ts";
import { FAKTEN } from "../../testhilfen/installationen.ts";
import { testServer } from "../../testhilfen/server.ts";
import { agentAnfrage, agentBeitreten, fingerabdruckVon } from "../../testhilfen/tls.ts";
import { schreiben } from "../audit/index.ts";
import { dienstAnlegen } from "../dienste/dienste.ts";
import { serverSperren, serverZumFingerabdruck } from "../server/index.ts";
import { sitzung } from "./sitzung.ts";
import type { Sockel } from "./verbindungen.ts";

/*
 * BAULISTE.md Z-303: rotating the certificate over the running connection. The session runs here
 * without TLS; which certificate opened it is what the guard found for its fingerprint.
 */
const TAG = 24 * 3600_000;

const aufgebaut = async () => {
  const server = testServer();
  const inhaber = await server.inhaber();
  const { token } = await serverHinzufuegen(inhaber);
  const agent = await agentBeitreten(server, token);
  const fingerabdruck = await fingerabdruckVon(agent.zertifikat);
  const oeffnen = async (fp = fingerabdruck) => {
    const gefunden = serverZumFingerabdruck(server.db, fp);
    if (!gefunden) throw new Error("not found");
    const gesendet: Record<string, unknown>[] = [];
    const geschlossen: number[] = [];
    const sockel: Sockel = {
      senden: (text) => gesendet.push(JSON.parse(text)),
      schliessen: (code) => geschlossen.push(code),
    };
    const s = sitzung(server.deps, gefunden);
    s.offen(sockel);
    await s.nachricht(
      JSON.stringify({
        typ: "hallo",
        protokoll: PROTOKOLL_VERSION,
        agentVersion: "0.0.0",
        architektur: "amd64",
        zeit: 1,
      }),
    );
    return { s, gesendet, geschlossen };
  };
  const anfrage = async () => {
    const { csr } = await agentAnfrage();
    return JSON.stringify({ typ: "zertifikat_anfrage", protokoll: PROTOKOLL_VERSION, csr });
  };
  return { server, agent, fingerabdruck, oeffnen, anfrage };
};

describe("rotating the certificate", () => {
  it("issues no new certificate earlier than 30 days before the old one ends", async () => {
    const { server, agent, oeffnen, anfrage } = await aufgebaut();
    server.stelleUhr(agent.gueltigBis - ROTIEREN_VOR_MS - 1);
    const { s, gesendet } = await oeffnen();
    await s.nachricht(await anfrage());
    expect(gesendet.map((n) => n.typ)).toEqual(["willkommen"]);
    expect(server.db.select().from(serverTabelle).get()?.fingerabdruckNeu).toBeNull();
  });

  it("issues one in the last 30 days, and both certificates open the door until the new one is used", async () => {
    const { server, agent, fingerabdruck, oeffnen, anfrage } = await aufgebaut();
    server.stelleUhr(agent.gueltigBis - 10 * TAG);
    const { s, gesendet } = await oeffnen();
    expect(gesendet[0]).toMatchObject({
      typ: "willkommen",
      zertifikatGueltigBis: agent.gueltigBis,
    });
    await s.nachricht(await anfrage());
    const antwort = gesendet[1] as {
      typ: string;
      zertifikat: string;
      ca: string;
      gueltigBis: number;
    };
    expect(antwort.typ).toBe("zertifikat");
    expect(antwort.ca).toBe(agent.ca);
    expect(antwort.gueltigBis).toBe(server.jetzt() + 365 * TAG);
    const neu = new x509.X509Certificate(antwort.zertifikat);
    expect(neu.subject).toBe(`CN=${agent.serverId}`);
    const neuerFingerabdruck = await fingerabdruckVon(antwort.zertifikat);
    expect(serverZumFingerabdruck(server.db, fingerabdruck)).toMatchObject({ neu: false });
    expect(serverZumFingerabdruck(server.db, neuerFingerabdruck)).toMatchObject({ neu: true });

    // the agent connects with the new one: it replaces the old, which opens nothing any more
    const zweite = await oeffnen(neuerFingerabdruck);
    expect(zweite.gesendet[0]).toMatchObject({
      typ: "willkommen",
      zertifikatGueltigBis: antwort.gueltigBis,
    });
    expect(serverZumFingerabdruck(server.db, fingerabdruck)).toBeUndefined();
    expect(server.db.select().from(serverTabelle).get()).toMatchObject({
      fingerabdruck: neuerFingerabdruck,
      zertifikatGueltigBis: antwort.gueltigBis,
      fingerabdruckNeu: null,
    });
    const aktionen = server.db
      .select()
      .from(auditLog)
      .all()
      .map((e) => e.aktion);
    expect(aktionen).toEqual(
      expect.arrayContaining(["server.zertifikat-ausstellen", "server.zertifikat-rotiert"]),
    );
  });

  it("refuses a request that is not signed by its key", async () => {
    const { server, agent, oeffnen, anfrage } = await aufgebaut();
    server.stelleUhr(agent.gueltigBis - TAG);
    const { s, gesendet } = await oeffnen();
    const echt = JSON.parse(await anfrage()) as { csr: string };
    const zeilen = echt.csr.split("\n");
    const i = zeilen.length - 3;
    zeilen[i] = (zeilen[i] ?? "").replace(/^./, (z) => (z === "A" ? "B" : "A"));
    await s.nachricht(
      JSON.stringify({ ...echt, typ: "zertifikat_anfrage", protokoll: 1, csr: zeilen.join("\n") }),
    );
    expect(gesendet).toHaveLength(1);
    expect(server.log.some((z) => z.includes("certificate not rotated"))).toBe(true);
  });

  it("drops a rotated certificate that waits when the server is revoked", async () => {
    const { server, agent, oeffnen, anfrage } = await aufgebaut();
    server.stelleUhr(agent.gueltigBis - TAG);
    const { s, gesendet } = await oeffnen();
    await s.nachricht(await anfrage());
    const neuerFingerabdruck = await fingerabdruckVon(String(gesendet[1]?.zertifikat));
    const betreiberId = server.db.select().from(serverTabelle).get()?.betreiberId ?? "";
    const kontext = { betreiberId, akteur: "test", jetzt: server.jetzt(), grund: "Test" };
    expect(serverSperren(server.db, server.schreibDb, kontext, agent.serverId).ok).toBe(true);
    expect(serverZumFingerabdruck(server.db, neuerFingerabdruck)).toBeUndefined();
    expect(server.db.select().from(serverTabelle).get()?.fingerabdruckNeu).toBeNull();
  });
});

describe("heartbeats", () => {
  it("keeps one per interval: an agent that floods them cannot fill the table past the audit log", async () => {
    const { server, oeffnen } = await aufgebaut();
    const { s } = await oeffnen();
    const beat = JSON.stringify({ typ: "heartbeat", protokoll: PROTOKOLL_VERSION, zeit: 1 });
    const start = server.jetzt();
    for (let i = 0; i < 100; i++) {
      server.stelleUhr(start + i * 100);
      await s.nachricht(beat);
    }
    // ten seconds of beats, a third of an interval: one row
    expect(server.db.select().from(heartbeats).all()).toHaveLength(1);
    server.stelleUhr(start + HEARTBEAT_MS);
    await s.nachricht(beat);
    expect(server.db.select().from(heartbeats).all()).toHaveLength(2);
  });
});

describe("the units an observed server reads (Z-1103)", () => {
  it("are sent after willkommen to an observed server, and nothing to a managed one", async () => {
    const { server, fingerabdruck, oeffnen } = await aufgebaut();
    const sv = serverZumFingerabdruck(server.db, fingerabdruck)?.server;
    if (!sv) throw new Error("no server");
    expect((await oeffnen()).gesendet.map((n) => n.typ)).toEqual(["willkommen"]);
    const kontext = { betreiberId: sv.betreiberId, akteur: "t", jetzt: server.jetzt(), grund: "t" };
    schreiben(server.schreibDb, kontext, "test", (w) =>
      w.aendern(
        "server",
        { serverId: sv.serverId },
        { fakten: JSON.stringify({ ...FAKTEN, nurBeobachten: true }), faktenAm: 1 },
      ),
    );
    const innen = { serverId: sv.serverId, nutzer: null, units: ["caddy.service"] };
    const r = dienstAnlegen(server.db, server.schreibDb, kontext, {
      name: "Caddy",
      host: "teufel-it.de",
      pfad: "/",
      kundeId: null,
      innen: { ...innen, health: { art: "keine" } },
    });
    if (!r.ok) throw new Error(r.grund);
    const { gesendet } = await oeffnen();
    expect(gesendet.map((n) => n.typ)).toEqual(["willkommen", "beobachten"]);
    expect(gesendet[1]?.dienste).toEqual([
      { dienstId: r.dienst.id, nutzer: null, units: ["caddy.service"], health: { art: "keine" } },
    ]);
  });
});

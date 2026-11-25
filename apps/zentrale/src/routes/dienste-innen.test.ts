import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, dienste } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { FAKTEN } from "../testhilfen/installationen.ts";
import { serverMitAgent } from "../testhilfen/installationen-api.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-1103 through the API: the units the agent reads inside an observed service, only on
 * one of the operator's servers that is only observed (Z-1102); a name off the pattern (space, `;`,
 * `/`, leading `-`) is refused and nothing stored; the agent of the server before and after a
 * change gets the new list with `beobachten`; no operator names or reaches another's server.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> & { fehler?: string } };

let server: TestServer;
let teufel: Person;
let partner: Person;
let beobachtet: string;
let zweiter: string;
let verwaltet: string;
let partnerServer: string;
const agent: Record<string, unknown>[] = [];
const zweiterAgent: Record<string, unknown>[] = [];
const verwalteterAgent: Record<string, unknown>[] = [];

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
): Promise<Antwort> => (await p.json(pfad, init)) as Antwort;

const nurBeobachten = (p: Person, id: string) =>
  schreiben(
    server.schreibDb,
    { betreiberId: p.betreiberId, akteur: "test", jetzt: server.jetzt(), grund: "Test" },
    "test",
    (w) =>
      w.aendern(
        "server",
        { serverId: id },
        { fakten: JSON.stringify({ ...FAKTEN, nurBeobachten: true }), faktenAm: server.jetzt() },
      ),
  );

const listen = (gesendet: Record<string, unknown>[]) =>
  gesendet.filter((n) => n.typ === "beobachten").map((n) => n.dienste);

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  beobachtet = await serverMitAgent(server, json, teufel, agent);
  zweiter = await serverMitAgent(server, json, teufel, zweiterAgent);
  verwaltet = await serverMitAgent(server, json, teufel, verwalteterAgent);
  partnerServer = await serverMitAgent(server, json, partner, []);
  nurBeobachten(teufel, beobachtet);
  nurBeobachten(teufel, zweiter);
  nurBeobachten(partner, partnerServer);
}, 60_000);

const innen = (serverId: string, mehr: Record<string, unknown> = {}) => ({
  serverId,
  nutzer: "tristan",
  units: ["kontext.service", "kontext-db.service"],
  port: 3000,
  pfad: "/health",
  ...mehr,
});

const anlegen = (p: Person, mit: Record<string, unknown> | null) =>
  json(p, "/api/v1/dienste", {
    body: { name: "Kontext", adresse: "https://kontext.teufel-it.de", innen: mit },
  });

describe("the units of an observed service", () => {
  it("are taken on an observed server and sent to its agent, changed and removed", async () => {
    const neu = await anlegen(teufel, innen(beobachtet));
    expect(neu.status).toBe(201);
    expect(neu.daten.innen).toEqual({
      serverId: beobachtet,
      nutzer: "tristan",
      units: ["kontext.service", "kontext-db.service"],
      health: { art: "http", port: 3000, pfad: "/health" },
    });
    expect(neu.daten.innenStand).toMatchObject({
      bewertung: "unbekannt",
      grund: { code: "noch_keine_meldung" },
    });
    const id = String(neu.daten.id);
    expect(listen(agent).at(-1)).toEqual([
      {
        dienstId: id,
        nutzer: "tristan",
        units: ["kontext.service", "kontext-db.service"],
        health: { art: "http", port: 3000, pfad: "/health" },
      },
    ]);

    // moved to the second server as units of the system with a TCP check: both agents hear of it
    const umgezogen = await json(teufel, `/api/v1/dienste/${id}`, {
      method: "PUT",
      body: {
        name: "Kontext",
        adresse: "https://kontext.teufel-it.de",
        innen: { serverId: zweiter, nutzer: null, units: ["caddy.service"], port: 5432 },
      },
    });
    expect(umgezogen.status).toBe(200);
    expect(listen(agent).at(-1)).toEqual([]);
    expect(listen(zweiterAgent).at(-1)).toEqual([
      { dienstId: id, nutzer: null, units: ["caddy.service"], health: { art: "tcp", port: 5432 } },
    ]);

    expect((await json(teufel, `/api/v1/dienste/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(listen(zweiterAgent).at(-1)).toEqual([]);
    expect(listen(verwalteterAgent)).toEqual([]);
    const aktionen = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.ziel === `dienste:${id}`)
      .map((e) => e.aktion);
    expect(aktionen).toEqual(["dienst.anlegen", "dienst.aendern", "dienst.entfernen"]);
  });

  it.each([
    ["a unit with a space", { units: ["kontext service.service"] }],
    ["a unit with ;", { units: ["kontext;reboot.service"] }],
    ["a unit with /", { units: ["../kontext.service"] }],
    ["a unit with a leading -", { units: ["--host=x.service"] }],
    ["a user with a space", { nutzer: "a b" }],
    ["a user with ;", { nutzer: "a;b" }],
    ["a user with /", { nutzer: "a/b" }],
    ["a user with a leading -", { nutzer: "-u" }],
    ["no unit", { units: [] }],
    ["a path off the pattern", { pfad: "//evil.example" }],
  ])("refuses %s and stores nothing", async (_, mehr) => {
    const vorher = server.db.select().from(dienste).all().length;
    const r = await anlegen(teufel, innen(beobachtet, mehr));
    expect(r.status).toBe(400);
    expect(server.db.select().from(dienste).all()).toHaveLength(vorher);
  });

  it("refuses a managed server, and a server of another operator as unknown", async () => {
    expect(await anlegen(teufel, innen(verwaltet))).toMatchObject({
      status: 409,
      daten: { fehler: "server_verwaltet" },
    });
    expect(await anlegen(teufel, innen(partnerServer))).toMatchObject({
      status: 404,
      daten: { fehler: "kein_server" },
    });
    expect(await anlegen(partner, innen(beobachtet))).toMatchObject({
      status: 404,
      daten: { fehler: "kein_server" },
    });
    expect(listen(agent).filter((l) => (l as unknown[]).length > 0)).toHaveLength(1);
  });

  it("are neither seen nor changed by another operator", async () => {
    const neu = await anlegen(teufel, innen(beobachtet));
    const id = String(neu.daten.id);
    const liste = await json(partner, "/api/v1/dienste");
    expect(liste.daten).toEqual({ dienste: [] });
    const fremd = await json(partner, `/api/v1/dienste/${id}`, {
      method: "PUT",
      body: { name: "X", adresse: "https://x.partner.test", innen: null },
    });
    expect(fremd.status).toBe(404);
    expect((await json(partner, `/api/v1/dienste/${id}`, { method: "DELETE" })).status).toBe(404);
    expect(listen(agent).at(-1)).toHaveLength(1);
  });
});

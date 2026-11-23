import { describe, expect, it } from "vitest";
import { PFORTE_SERVER, pforteGrundkonfiguration, UNBEKANNT_ID } from "./grund.ts";
import {
  AGENT_PFADE,
  FINGERABDRUCK_KOPF,
  ZENTRALE_AGENT_ID,
  ZENTRALE_UI_ID,
  type ZentraleVorne,
  zentraleInPforte,
} from "./zentrale.ts";

const vorne: ZentraleVorne = {
  uiHost: "zentrale.example.de",
  agentHost: "agent.example.de",
  port: 8300,
  uiNetze: ["10.8.0.0/24"],
  clientCas: ["MIIBdGVzdA=="],
};

type Server = {
  routes: { "@id": string; match?: Record<string, unknown>[]; handle: Record<string, unknown>[] }[];
  tls_connection_policies?: unknown[];
};
const server = (konfiguration: unknown): Server =>
  (konfiguration as { apps: { http: { servers: Record<string, Server> } } }).apps.http.servers[
    PFORTE_SERVER
  ] as Server;

const ok = (aktuell: unknown, z: ZentraleVorne = vorne) => {
  const r = zentraleInPforte(aktuell, z);
  if (!r.ok) throw new Error(r.grund);
  return r.konfiguration;
};

describe("the Zentrale behind the Pforte of its server", () => {
  it("starts from the base configuration when the Pforte has none yet", () => {
    const k = ok(null);
    const s = server(k);
    expect(s.routes.map((r) => r["@id"])).toEqual([
      ZENTRALE_UI_ID,
      ZENTRALE_AGENT_ID,
      UNBEKANNT_ID,
    ]);
    expect((k as { admin: unknown }).admin).toEqual(pforteGrundkonfiguration().admin);
  });

  it("lets the interface in only from the given networks, to the Zentrale on loopback", () => {
    const ui = server(ok(null)).routes[0];
    expect(ui?.match).toEqual([
      { host: ["zentrale.example.de"], remote_ip: { ranges: ["10.8.0.0/24"] } },
    ]);
    const proxy = ui?.handle[0] as {
      upstreams: unknown;
      headers: { request: { set: Record<string, string[]>; delete: string[] } };
    };
    expect(proxy.upstreams).toEqual([{ dial: "127.0.0.1:8300" }]);
    // the fingerprint header is the Pforte's alone: on the interface's host it is removed
    expect(proxy.headers.request.delete).toContain(FINGERABDRUCK_KOPF);
    expect(proxy.headers.request.set).not.toHaveProperty(FINGERABDRUCK_KOPF);
    expect(proxy.headers.request.set["X-Forwarded-For"]).toEqual(["{http.request.remote.host}"]);
  });

  it("opens only the agent's paths on agent.<domain> and passes the client certificate's hash on", () => {
    const agent = server(ok(null)).routes[1];
    expect(agent?.match).toEqual([{ host: ["agent.example.de"], path: AGENT_PFADE }]);
    expect(AGENT_PFADE).toEqual(["/install.sh", "/agent/*", "/api/v1/agent/*", "/health"]);
    const proxy = agent?.handle[0] as {
      headers: { request: { set: Record<string, string[]> } };
      stream_close_delay: string;
    };
    // whatever a client sent under that name is overwritten (set, not add)
    expect(proxy.headers.request.set[FINGERABDRUCK_KOPF]).toEqual([
      "{http.request.tls.client.fingerprint}",
    ]);
    expect(proxy.stream_close_delay).toBe("5m");
  });

  it("asks agent.<domain> for a client certificate and checks it against the operators' CAs", () => {
    expect(server(ok(null)).tls_connection_policies).toEqual([
      {
        match: { sni: ["agent.example.de"] },
        client_authentication: {
          ca: { provider: "inline", trusted_ca_certs: ["MIIBdGVzdA=="] },
          mode: "verify_if_given",
        },
      },
      {},
    ]);
  });

  it("leaves agent.<domain> out while no operator has a CA", () => {
    const s = server(ok(null, { ...vorne, clientCas: [] }));
    expect(s.routes.map((r) => r["@id"])).toEqual([ZENTRALE_UI_ID, UNBEKANNT_ID]);
    expect(s.tls_connection_policies).toEqual([{}]);
  });

  it("keeps the installations' routes and replaces only its own, run again", () => {
    const vorher = ok(null);
    const installation = { "@id": "haben-teufel", match: [{ host: ["a.b"] }], handle: [] };
    server(vorher).routes.unshift(installation as Server["routes"][number]);
    const danach = ok(vorher, { ...vorne, clientCas: ["MIIBYW5kZXJl", "MIIBdGVzdA=="] });
    expect(server(danach).routes.map((r) => r["@id"])).toEqual([
      ZENTRALE_UI_ID,
      ZENTRALE_AGENT_ID,
      "haben-teufel",
      UNBEKANNT_ID,
    ]);
    expect(server(danach).tls_connection_policies?.[0]).toMatchObject({
      client_authentication: { ca: { trusted_ca_certs: ["MIIBYW5kZXJl", "MIIBdGVzdA=="] } },
    });
  });

  it("takes certificates from Caddy's local CA only when asked to, for tests", () => {
    expect(ok(null)).not.toHaveProperty("apps.tls");
    expect(ok(null, { ...vorne, zertifikate: "intern" })).toHaveProperty("apps.tls");
  });

  it("refuses what is not the Pforte's configuration", () => {
    for (const aktuell of [{}, { apps: { http: { servers: {} } } }, "x", 7])
      expect(zentraleInPforte(aktuell, vorne).ok).toBe(false);
  });

  it("refuses hosts, networks, a port and CAs it cannot put into Caddy's JSON as they are", () => {
    const falsch: Partial<ZentraleVorne>[] = [
      { uiHost: "Zentrale.example.de" },
      { uiHost: "zentrale.example.de/x" },
      { agentHost: "zentrale.example.de" },
      { agentHost: "{http.request.host}" },
      { uiNetze: [] },
      { uiNetze: ["0.0.0.0/0 x"] },
      { uiNetze: ["10.8.0.0"] },
      { port: 0 },
      { port: 70000 },
      { clientCas: ["kein base64!"] },
    ];
    for (const f of falsch) expect(zentraleInPforte(null, { ...vorne, ...f }).ok).toBe(false);
    expect(zentraleInPforte(null, { ...vorne, uiNetze: ["fd00::/64", "127.0.0.1/32"] }).ok).toBe(
      true,
    );
  });
});

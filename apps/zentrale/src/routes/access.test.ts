import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { accessPruefen, accessSchluessel } from "../modules/access/index.ts";
import {
  AUD,
  certsAntwort,
  type Paar,
  paarErzeugen,
  TEAM,
  tokenSignieren,
} from "../modules/access/testhilfen.ts";
import { FINGERABDRUCK_HEADER } from "../modules/verbindung/herkunft.ts";
import { serverHinzufuegen } from "../testhilfen/agent.ts";
import { SOCKET_HEADER } from "../testhilfen/browser.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";
import { agentBeitreten, fingerabdruckVon } from "../testhilfen/tls.ts";

/*
 * BAULISTE.md Z-1104: with STEUERZENTRALE_ACCESS_TEAM and STEUERZENTRALE_ACCESS_AUD the Zentrale
 * takes interface and API only with a valid `Cf-Access-Jwt-Assertion`: without one, with a wrong
 * signature, audience or after its expiry 403 before any route; with one, the own login still
 * decides. agent.<domain> stays as it was, and a request through Cloudflare never gets an agent's
 * rights, whatever fingerprint header it brings. Keys are our own pair in place of the team's.
 */

let server: TestServer;
let paar: Paar;
let app: ReturnType<typeof createApp>;
let fingerabdruck: string;
const gefragt: string[] = [];

beforeAll(async () => {
  server = testServer(afterAll);
  server.stelleUhr(Date.now());
  paar = await paarErzeugen("kid-a");
  const inhaber = await server.inhaber();
  const agent = await agentBeitreten(server, (await serverHinzufuegen(inhaber)).token);
  fingerabdruck = await fingerabdruckVon(agent.zertifikat);
  const schluessel = accessSchluessel({
    team: TEAM,
    jetzt: server.jetzt,
    holen: async (url) => {
      gefragt.push(url);
      return Response.json(await certsAntwort(paar));
    },
  });
  app = createApp({
    ...server.deps,
    access: (token) =>
      accessPruefen(token, { team: TEAM, aud: AUD, jetzt: server.jetzt(), schluessel }),
  });
}, 60_000);

const anfrage = (pfad: string, kopf: Record<string, string> = {}) =>
  app.request(pfad, { headers: { [SOCKET_HEADER]: "127.0.0.1", ...kopf } });

const mit = async (claims: Record<string, unknown> = {}) => ({
  "cf-access-jwt-assertion": await tokenSignieren(paar, server.jetzt(), claims),
});

describe("the interface behind Cloudflare Access", () => {
  it("answers 403 without a token, before any route, also for the interface's files", async () => {
    for (const pfad of ["/api/v1/ich", "/api/auth/get-session", "/", "/server"]) {
      const r = await anfrage(pfad);
      expect(r.status, pfad).toBe(403);
      expect(await r.json()).toEqual({ fehler: "access" });
    }
  });

  it("answers 403 to a wrong signature, a wrong audience and an expired token", async () => {
    const fremd = await paarErzeugen("kid-a");
    const s = Math.floor(server.jetzt() / 1000);
    for (const kopf of [
      { "cf-access-jwt-assertion": await tokenSignieren(fremd, server.jetzt()) },
      await mit({ aud: ["0".repeat(64)] }),
      await mit({ exp: s - 1 }),
      { "cf-access-jwt-assertion": "kein.jwt.token" },
    ])
      expect((await anfrage("/api/v1/ich", kopf)).status).toBe(403);
  });

  it("lets a valid token through to the own login, which still decides", async () => {
    const r = await anfrage("/api/v1/ich", await mit());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ fehler: "nicht_angemeldet" });
    expect(
      gefragt.every((u) => u === "https://teufel.cloudflareaccess.com/cdn-cgi/access/certs"),
    ).toBe(true);
  });

  it("leaves agent.<domain> to agents: install.sh, health and the connection need no token", async () => {
    expect((await anfrage("/health")).status).toBe(200);
    const verbindung = await anfrage("/api/v1/agent/verbindung", {
      [FINGERABDRUCK_HEADER]: fingerabdruck,
    });
    // the agent's certificate opened the guard; only the WebSocket is missing
    expect(verbindung.status).toBe(426);
  });

  it("gives no agent's rights to a request through Cloudflare with a forged fingerprint", async () => {
    for (const kopf of [
      { ...(await mit()), [FINGERABDRUCK_HEADER]: fingerabdruck },
      { "cf-connecting-ip": "203.0.113.9", [FINGERABDRUCK_HEADER]: fingerabdruck },
      { "cf-ray": "8f1c2d3e4f5a6b7c-FRA", [FINGERABDRUCK_HEADER]: fingerabdruck },
    ]) {
      const r = await anfrage("/api/v1/agent/verbindung", kopf);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ fehler: "kein_zertifikat" });
    }
  });
});

describe("without Cloudflare Access", () => {
  it("takes the interface as before (WireGuard in front)", async () => {
    const ohne = createApp(server.deps);
    const r = await ohne.request("/api/v1/ich", { headers: { [SOCKET_HEADER]: "127.0.0.1" } });
    expect(r.status).toBe(401);
  });
});

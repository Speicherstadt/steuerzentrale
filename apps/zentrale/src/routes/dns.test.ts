import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, dnsEinstellungen, geheimnisse } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { dnsAbgleichen } from "../modules/dns/index.ts";
import { spalteVerschluesseln } from "../modules/geheim/spalten.ts";
import { cloudflareNachbau, TEST_TOKEN, TEST_ZONE } from "../testhilfen/cloudflare.ts";
import { dateiInhalt, KENNWORT, LIZENZ, signiert } from "../testhilfen/installationen.ts";
import { kundeAnlegen, serverMitAgent } from "../testhilfen/installationen-api.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-407 over HTTP: the operator's domain, zone and Cloudflare token, set with a reason
 * by owner and technik, read by every role; the token only as `tokenGesetzt`, never in an answer,
 * only encrypted in the database. An installation made through the API gets its records at the
 * stand-in of Cloudflare's API, and its agent never sees the token. No operator reaches another's
 * DNS settings (a test per endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

const cf = cloudflareNachbau();
let server: TestServer;
let teufel: Person;
let technik: Awaited<ReturnType<TestServer["eingeladen"]>>;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
const agent: Record<string, unknown>[] = [];
const antworten: unknown[] = [];

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
) => {
  const a = (await p.json(pfad, init)) as Antwort;
  antworten.push(a.daten);
  return a;
};

const DOMAIN = "apps.teufel.example";
const setzen = (teil: Record<string, unknown> = {}) => ({
  domain: DOMAIN,
  zoneId: TEST_ZONE,
  token: TEST_TOKEN,
  grund: "Zone bei Cloudflare angelegt",
  ...teil,
});

beforeAll(async () => {
  server = testServer(afterAll);
  afterAll(() => cf.stoppen());
  teufel = await server.inhaber();
  technik = await server.eingeladen(teufel, "technik");
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
}, 60_000);

describe("the DNS settings", () => {
  it("start empty", async () => {
    expect(await json(support, "/api/v1/dns")).toEqual({
      status: 200,
      daten: { domain: null, zoneId: null, tokenGesetzt: false },
    });
  });

  it("are set with a reason; the token comes back only as set and is kept when left out", async () => {
    const gesetzt = await json(teufel, "/api/v1/dns", { method: "PUT", body: setzen() });
    expect(gesetzt).toEqual({
      status: 200,
      daten: { domain: DOMAIN, zoneId: TEST_ZONE, tokenGesetzt: true },
    });
    const { token: _, ...ohneToken } = setzen({ grund: "nur gelesen" });
    expect((await json(technik, "/api/v1/dns", { method: "PUT", body: ohneToken })).daten).toEqual(
      gesetzt.daten,
    );
    expect((await json(support, "/api/v1/dns")).daten).toEqual(gesetzt.daten);
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "dns.einstellungen");
    expect(eintraege.map((e) => [e.akteur, e.grund, e.ziel])).toEqual([
      [teufel.nutzerId, "Zone bei Cloudflare angelegt", "dnsEinstellungen"],
      [teufel.nutzerId, "Zone bei Cloudflare angelegt", "geheimnisse:dns-cloudflare-token"],
    ]);
    expect(eintraege[1]?.inhalt).toContain("[verschlüsselt]");
  });

  it("refuses support, an invalid field and a missing reason", async () => {
    expect(await json(support, "/api/v1/dns", { method: "PUT", body: setzen() })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    for (const falsch of [
      { domain: "Apps.Example" },
      { domain: "localhost" },
      { zoneId: "zone" },
      { token: "kurz" },
      { token: `${TEST_TOKEN}\nX-Header: 1` },
      { grund: " " },
      { unbekannt: 1 },
    ])
      expect(
        (await json(teufel, "/api/v1/dns", { method: "PUT", body: setzen(falsch) })).status,
      ).toBe(400);
  });
});

describe("an installation below the domain", () => {
  it("gets its records at Cloudflare, and the token stays in the Zentrale", async () => {
    await json(teufel, "/api/v1/dns", { method: "PUT", body: setzen() });
    schreiben(
      server.schreibDb,
      { betreiberId: teufel.betreiberId, akteur: "t", jetzt: 1, grund: "t" },
      "test",
      (w) =>
        w.einfuegen("appEinstellungen", {
          betreiberId: teufel.betreiberId,
          app: "probe",
          name: "PROBE_LIZENZ",
          wert: null,
          wertVerschluesselt: spalteVerschluesseln(
            server.schluessel,
            "appEinstellungen",
            teufel.betreiberId,
            { app: "probe", name: "PROBE_LIZENZ" },
            JSON.stringify(LIZENZ),
          ),
          geaendertAm: 1,
        }),
    );
    const kundeId = await kundeAnlegen(json, teufel, "Kanzlei West");
    const serverId = await serverMitAgent(server, json, teufel, agent);
    const host = `probe.kanzlei-west.${DOMAIN}`;
    const angelegt = await json(teufel, "/api/v1/installationen", {
      body: {
        kundeId,
        serverId,
        ...signiert("probe"),
        host,
        einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
        grund: "Bestellung",
      },
    });
    expect(angelegt.status).toBe(201);
    await dnsAbgleichen({ ...server.deps, fetch, basis: cf.url });
    expect(
      cf
        .eintraege()
        .filter((e) => e.name === host)
        .map((e) => e.type),
    ).toEqual(["A", "AAAA"]);
    // with records there, domain and zone stay as they are; the token may change
    expect(
      await json(teufel, "/api/v1/dns", { method: "PUT", body: setzen({ domain: "neu.example" }) }),
    ).toEqual({ status: 409, daten: { fehler: "dns_in_benutzung" } });
    expect(
      (
        await json(teufel, "/api/v1/dns", {
          method: "PUT",
          body: setzen({ token: `${TEST_TOKEN}x` }),
        })
      ).status,
    ).toBe(200);

    expect(agent.length).toBeGreaterThan(0);
    expect(JSON.stringify(agent)).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(antworten)).not.toContain(TEST_TOKEN);
    expect(server.log.join("\n")).not.toContain(TEST_TOKEN);
    expect(dateiInhalt(server.pfad)).not.toContain(TEST_TOKEN);
  });
});

describe("no operator reaches another's DNS settings", () => {
  it("GET /api/v1/dns shows one's own only", async () => {
    expect((await json(partner, "/api/v1/dns")).daten).toEqual({
      domain: null,
      zoneId: null,
      tokenGesetzt: false,
    });
  });

  it("PUT /api/v1/dns sets one's own only", async () => {
    const vorher = server.db
      .select()
      .from(dnsEinstellungen)
      .all()
      .find((z) => z.betreiberId === teufel.betreiberId);
    const wert = server.db
      .select()
      .from(geheimnisse)
      .all()
      .find(
        (g) => g.betreiberId === teufel.betreiberId && g.geheimnisId === "dns-cloudflare-token",
      )?.wert;
    const a = await json(partner, "/api/v1/dns", {
      method: "PUT",
      body: setzen({ domain: "apps.partner.example", token: "partner-token-0000000000000000" }),
    });
    expect(a.daten).toEqual({
      domain: "apps.partner.example",
      zoneId: TEST_ZONE,
      tokenGesetzt: true,
    });
    expect(
      server.db
        .select()
        .from(dnsEinstellungen)
        .all()
        .find((z) => z.betreiberId === teufel.betreiberId),
    ).toEqual(vorher);
    expect(
      server.db
        .select()
        .from(geheimnisse)
        .all()
        .find(
          (g) => g.betreiberId === teufel.betreiberId && g.geheimnisId === "dns-cloudflare-token",
        )?.wert,
    ).toBe(wert);
    expect((await json(teufel, "/api/v1/dns")).daten).toMatchObject({ domain: DOMAIN });
  });
});

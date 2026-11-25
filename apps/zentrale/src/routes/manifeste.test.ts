import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, ereignisse, manifeste } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { signiert } from "../testhilfen/installationen.ts";
import { probeVersion } from "../testhilfen/manifeste.ts";
import { registryNachbau } from "../testhilfen/registry.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-501 over HTTP: importing a manifest through the interface (owner and inhaber2, with
 * a reason), the apps with their versions, a manifest's text, asking the registries now, and the
 * versions each installation is offered. A test per route for the roles; the manifests hold for
 * every operator, but who imported one only its own operator learns.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

// probe names registry.example.org/probe; the redirect sends it to the stand-in
const registry = registryNachbau({ repos: { probe: ["1.0.0", "1.1.0", "v1.2.0", "latest"] } });
let server: TestServer;
let teufel: Person;
let inhaber2: Awaited<ReturnType<TestServer["eingeladen"]>>;
let mitglied: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;

const json = async (p: Pick<Person, "json">, pfad: string, init?: Parameters<Person["json"]>[1]) =>
  (await p.json(pfad, init)) as Antwort;

const importieren = (p: Pick<Person, "json">, eingabe: object, grund?: string) =>
  json(p, "/api/v1/manifeste", { body: { ...eingabe, ...(grund ? { grund } : {}) } });

type Version = { version: string; zustand: string; dringend: boolean; vorabversion: boolean };
type App = {
  app: string;
  versionen: (Version & { importiert: Record<string, unknown> | null })[];
  registry: Record<string, unknown> | null;
};
const apps = async (p: Pick<Person, "json">) => (await json(p, "/api/v1/apps")).daten.apps as App[];

beforeAll(async () => {
  server = testServer(afterAll, { fetch, umleitung: registry.url });
  teufel = await server.inhaber();
  inhaber2 = await server.eingeladen(teufel, "inhaber");
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
}, 60_000);
afterAll(() => registry.stoppen());

describe("importing a manifest through the interface", () => {
  it("stores it with a reason in the audit log, by inhaber2", async () => {
    const a = await importieren(inhaber2, signiert("probe"), "Release 1.0.0");
    expect(a).toEqual({
      status: 201,
      daten: {
        neu: true,
        app: "probe",
        version: "1.0.0",
        dringend: false,
        vorabversion: false,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        importiert: { am: server.jetzt(), durch: "mitglied", nutzerId: inhaber2.nutzerId },
      },
    });
    const eintrag = server.db
      .select()
      .from(auditLog)
      .all()
      .find((e) => e.aktion === "manifest.importieren");
    expect(eintrag).toMatchObject({
      betreiberId: teufel.betreiberId,
      akteur: inhaber2.nutzerId,
      grund: "Release 1.0.0",
      ziel: "manifeste:probe:1.0.0",
    });
  });

  it("changes nothing for the same text and refuses other content for the version", async () => {
    expect(await importieren(teufel, signiert("probe"), "noch einmal")).toMatchObject({
      status: 200,
      daten: { neu: false },
    });
    expect(await importieren(teufel, signiert("probe-anders"), "anders")).toEqual({
      status: 409,
      daten: { fehler: "version_vergeben" },
    });
    expect(server.db.select().from(manifeste).all()).toHaveLength(1);
  });

  it("refuses a manifest without a valid signature and one without a reason", async () => {
    const falsch = { ...probeVersion("1.1.0"), signatur: signiert("stumm").signatur };
    expect(await importieren(teufel, falsch, "falsch")).toMatchObject({
      status: 422,
      daten: { fehler: "signatur_ungueltig" },
    });
    expect((await importieren(teufel, probeVersion("1.1.0"))).status).toBe(400);
    expect(await importieren(teufel, signiert("kaputt"), "kaputt")).toMatchObject({
      status: 422,
      daten: { fehler: "manifest_ungueltig" },
    });
  });

  it("is not for mitglied", async () => {
    expect(await importieren(mitglied, probeVersion("1.1.0"), "Support")).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    expect(server.db.select().from(manifeste).all()).toHaveLength(1);
  });
});

describe("the apps and their versions", () => {
  it("show the imported versions to every role, with dringend and pre-release", async () => {
    await importieren(teufel, probeVersion("1.2.0"), "dringend");
    await importieren(teufel, probeVersion("2.0.0-rc.1"), "Vorabversion");
    const [probe] = await apps(mitglied);
    expect(probe?.versionen.map((v) => [v.version, v.zustand, v.dringend, v.vorabversion])).toEqual(
      [
        ["2.0.0-rc.1", "verfuegbar", false, true],
        ["1.2.0", "verfuegbar", true, false],
        ["1.0.0", "verfuegbar", false, false],
      ],
    );
    expect(probe?.registry).toBeNull();
  });

  it("name who imported only to the own operator", async () => {
    const [eigen] = await apps(teufel);
    const [fremd] = await apps(partner);
    expect(eigen?.versionen.at(-1)?.importiert).toMatchObject({
      durch: "mitglied",
      nutzerId: inhaber2.nutzerId,
    });
    expect(fremd?.versionen.at(-1)?.importiert).toEqual({
      am: server.jetzt(),
      durch: "anderer_betreiber",
    });
    expect(JSON.stringify(fremd)).not.toContain(inhaber2.nutzerId);
  });

  it("give a manifest's text to every role", async () => {
    const a = await json(mitglied, "/api/v1/manifeste/probe/1.2.0");
    expect(a).toMatchObject({
      status: 200,
      daten: {
        app: "probe",
        version: "1.2.0",
        dringend: true,
        text: probeVersion("1.2.0").manifest,
      },
    });
    expect(await json(mitglied, "/api/v1/manifeste/probe/9.9.9")).toEqual({
      status: 404,
      daten: { fehler: "kein_manifest" },
    });
  });

  it("show a newer version of the registry as manifest missing, asked by inhaber2", async () => {
    const a = await json(inhaber2, "/api/v1/versionen/abfragen", { method: "POST" });
    expect(a.status).toBe(200);
    const [probe] = a.daten.apps as App[];
    expect(probe?.registry).toMatchObject({ image: "registry.example.org/probe", fehler: null });
    // 1.1.0 is older than the newest imported release: skipped, no news
    expect(probe?.versionen.map((v) => [v.version, v.zustand])).toEqual([
      ["2.0.0-rc.1", "verfuegbar"],
      ["1.2.0", "verfuegbar"],
      ["1.0.0", "verfuegbar"],
    ]);
    // a release newer than the newest release is new, whatever pre-release came before it
    registry.tags("probe", ["1.0.0", "1.2.0", "1.3.0", "2.0.0-rc.0"]);
    await json(teufel, "/api/v1/versionen/abfragen", { method: "POST" });
    expect((await apps(mitglied))[0]?.versionen.map((v) => [v.version, v.zustand])).toEqual([
      ["2.0.0-rc.1", "verfuegbar"],
      ["1.3.0", "manifest_fehlt"],
      ["1.2.0", "verfuegbar"],
      ["1.0.0", "verfuegbar"],
    ]);
  });

  it("are not asked again by mitglied", async () => {
    expect(await json(mitglied, "/api/v1/versionen/abfragen", { method: "POST" })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
  });

  it("report a failing registry as an event to every operator", async () => {
    registry.scheitern(5);
    await json(teufel, "/api/v1/versionen/abfragen", { method: "POST" });
    for (const p of [teufel, partner]) {
      const { daten } = await json(p, "/api/v1/ereignisse");
      expect(JSON.stringify(daten)).toContain("registry_fehler");
    }
    const alle = server.db.select().from(ereignisse).all();
    expect(alle.filter((e) => e.art === "registry_fehler")).toHaveLength(2);
  });
});

describe("the versions each installation is offered", () => {
  const installation = (betreiberId: string, kundeId: string, installationId: string) =>
    schreiben(
      server.schreibDb,
      { betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
      "test",
      (w) => {
        w.einfuegen("kunden", {
          betreiberId,
          kundeId,
          name: kundeId,
          kontaktName: "Kim",
          kontaktEmail: "kim@kunde.test",
          kuerzel: kundeId,
          angelegtAm: 1,
        });
        w.einfuegen("vertraege", {
          betreiberId,
          vertragId: `v-${kundeId}`,
          kundeId,
          beginn: 1,
          angelegtAm: 1,
        });
        w.einfuegen("server", {
          betreiberId,
          serverId: `s-${installationId}`,
          name: "S",
          art: "gemeinsam",
          wartungsfenster: "{}",
          angelegtVon: "test",
          angelegtAm: 1,
        });
        w.einfuegen("installationen", {
          betreiberId,
          installationId,
          kundeId,
          serverId: `s-${installationId}`,
          app: "probe",
          version: "1.0.0",
          manifestHash: "0".repeat(64),
          manifest: signiert("probe").manifest,
          signatur: signiert("probe").signatur,
          host: `${installationId}.example`,
          ports: "{}",
          optionen: "[]",
          einstellungen: "{}",
          geheim: "x",
          zustand: "laeuft",
          angelegtVon: "test",
          angelegtAm: 1,
          geaendertAm: 1,
        });
      },
    );

  beforeAll(() => {
    installation(teufel.betreiberId, "kunde-extern", "probe-extern");
    installation(teufel.betreiberId, "kunde-intern", "probe-intern");
    installation(partner.betreiberId, "kunde-partner", "probe-partner");
  });

  it("are newer manifests, a pre-release only for an internal customer", async () => {
    await json(teufel, "/api/v1/kunden/kunde-intern/intern", {
      method: "PUT",
      body: { intern: true, grund: "unsere eigene" },
    });
    const { status, daten } = await json(mitglied, "/api/v1/updates");
    expect(status).toBe(200);
    const nach = Object.fromEntries(
      (daten.installationen as { installationId: string; angeboten: Version[] }[]).map((i) => [
        i.installationId,
        i.angeboten.map((v) => v.version),
      ]),
    );
    expect(nach).toEqual({ "probe-extern": ["1.2.0"], "probe-intern": ["2.0.0-rc.1", "1.2.0"] });
  });

  it("are the own installations' only", async () => {
    const { daten } = await json(partner, "/api/v1/updates");
    expect(
      (daten.installationen as { installationId: string }[]).map((i) => i.installationId),
    ).toEqual(["probe-partner"]);
  });
});

describe("marking a customer as internal", () => {
  const intern = (p: Pick<Person, "json">, kundeId: string, body: object) =>
    json(p, `/api/v1/kunden/${kundeId}/intern`, { method: "PUT", body });

  it("is for the owner only, with a reason in the audit log", async () => {
    expect(await intern(mitglied, "kunde-extern", { intern: true, grund: "x" })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    expect((await intern(teufel, "kunde-extern", { intern: true })).status).toBe(400);
    const a = await intern(teufel, "kunde-extern", { intern: true, grund: "Testkunde" });
    expect(a).toMatchObject({ status: 200, daten: { id: "kunde-extern", intern: true } });
    const eintrag = server.db.select().from(auditLog).all().at(-1);
    expect(eintrag).toMatchObject({
      aktion: "kunde.intern",
      ziel: "kunden:kunde-extern",
      grund: "Testkunde",
      akteur: teufel.nutzerId,
    });
    await intern(teufel, "kunde-extern", { intern: false, grund: "doch nicht" });
    expect((await json(mitglied, "/api/v1/kunden/kunde-extern")).daten.intern).toBe(false);
  });

  it("does not reach another operator's customer", async () => {
    expect(await intern(partner, "kunde-intern", { intern: false, grund: "fremd" })).toEqual({
      status: 404,
      daten: { fehler: "kein_kunde" },
    });
    expect((await json(teufel, "/api/v1/kunden/kunde-intern")).daten.intern).toBe(true);
  });
});

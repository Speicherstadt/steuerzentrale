import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, installationen } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { spalteVerschluesseln } from "../modules/geheim/spalten.ts";
import { FAKTEN, KENNWORT, LIZENZ, signiert } from "../testhilfen/installationen.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-402 over HTTP: the placement as the dialog's preview, making, listing, reading and
 * removing installations. Every role reads, owner and technik write; no operator reaches another's
 * installations (a test per endpoint); no answer carries a secret. Their state (Z-403) is tested in
 * installationen-zustand.test.ts.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

const BEGINN = Date.UTC(2026, 10, 30, 23);

let server: TestServer;
let teufel: Person;
let technik: Awaited<ReturnType<TestServer["eingeladen"]>>;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
let kundeId: string;
let serverId: string;
/** What the agent of Teufel IT's server got */
const agent: Record<string, unknown>[] = [];
/** Every answer of the API in these tests, searched for secrets at the end */
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

const wunsch = (teil: Record<string, unknown> = {}): Record<string, unknown> => ({
  kundeId,
  serverId,
  ...signiert("probe"),
  optionen: [],
  ...teil,
});

const neu = (host: string, teil: Record<string, unknown> = {}) =>
  wunsch({
    host,
    einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
    grund: "Auftrag vom 20.11.",
    ...teil,
  });

/** A server of the operator with facts and a connected agent */
const serverMitAgent = async (p: Person, gesendet: Record<string, unknown>[]) => {
  const { daten } = await json(p, "/api/v1/server", {
    body: {
      name: "Server A",
      art: "gemeinsam",
      wartungsfenster: { tage: [0], von: "03:00", bis: "04:00" },
      grund: "neu",
    },
  });
  const id = String(daten.serverId);
  const kontext = {
    betreiberId: p.betreiberId,
    akteur: "test",
    jetzt: server.jetzt(),
    grund: "Test",
  };
  schreiben(server.schreibDb, kontext, "test", (w) =>
    w.aendern(
      "server",
      { serverId: id },
      { fakten: JSON.stringify(FAKTEN), faktenAm: server.jetzt() },
    ),
  );
  const sockel = { senden: (t: string) => gesendet.push(JSON.parse(t)), schliessen: () => {} };
  server.deps.verbindungen.anmelden(p.betreiberId, id, sockel, server.jetzt());
  server.deps.verbindungen.gruessen(p.betreiberId, id, sockel);
  return id;
};

/** The operator's secret value for the test app, as Z-404 will write it */
const lizenzSetzen = (betreiberId: string) =>
  schreiben(
    server.schreibDb,
    { betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
    "test",
    (w) =>
      w.einfuegen("appEinstellungen", {
        betreiberId,
        app: "probe",
        name: "PROBE_LIZENZ",
        wert: null,
        wertVerschluesselt: spalteVerschluesseln(
          server.schluessel,
          "appEinstellungen",
          betreiberId,
          { app: "probe", name: "PROBE_LIZENZ" },
          JSON.stringify(LIZENZ),
        ),
        geaendertAm: 1,
      }),
  );

const anlegen = async (p: Pick<Person, "json">, host: string) => {
  const a = await json(p, "/api/v1/installationen", { body: neu(host) });
  if (a.status !== 201) throw new Error(`anlegen ${a.status} ${JSON.stringify(a.daten)}`);
  return a.daten as { installationId: string } & Record<string, unknown>;
};

/** Sets an installation's state as a finished setup job would */
const zustandSetzen = (betreiberId: string, installationId: string, zustand: "gescheitert") =>
  schreiben(
    server.schreibDb,
    { betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
    "test",
    (w) => w.aendern("installationen", { installationId }, { zustand }),
  );

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  technik = await server.eingeladen(teufel, "technik");
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  const { daten } = await json(teufel, "/api/v1/kunden", {
    body: {
      name: "Kanzlei Nord",
      kontakt: { name: "Kim", email: "kim@kanzlei.test" },
      vertrag: { sla: "basis", beginn: BEGINN },
      grund: "Vertrag",
    },
  });
  kundeId = String(daten.id);
  serverId = await serverMitAgent(teufel, agent);
  lizenzSetzen(teufel.betreiberId);
}, 60_000);

describe("the placement", () => {
  it("answers whether the app fits, writing nothing", async () => {
    const vorher = server.db.select().from(auditLog).all().length;
    expect(await json(support, "/api/v1/installationen/platzierung", { body: wunsch() })).toEqual({
      status: 200,
      daten: { platzierung: { art: "passt", hinweise: [] } },
    });
    expect(server.db.select().from(auditLog).all().length).toBe(vorher);
  });

  it("names the reasons when it does not fit", async () => {
    const { daten } = await json(teufel, "/api/v1/installationen/platzierung", {
      body: wunsch({ optionen: ["gibt-es-nicht"] }),
    });
    expect(daten).toEqual({
      platzierung: {
        art: "passt_nicht",
        gruende: [{ code: "unbekannte_option", werte: { option: "gibt-es-nicht" } }],
        hinweise: [],
      },
    });
  });

  it("refuses a manifest without a valid signature", async () => {
    const a = await json(teufel, "/api/v1/installationen/platzierung", {
      body: wunsch({ manifest: `${signiert("probe").manifest}\n` }),
    });
    expect(a).toMatchObject({ status: 422, daten: { fehler: "signatur_ungueltig" } });
  });
});

describe("an installation over the API", () => {
  it("is made with a reason, listed and read with its jobs", async () => {
    const i = await anlegen(technik, "liste.kanzlei.example");
    expect(i).toEqual({
      installationId: expect.stringMatching(/^probe-[a-z0-9]{6}$/),
      kundeId,
      serverId,
      app: "probe",
      version: "1.0.0",
      manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      host: "liste.kanzlei.example",
      httpPort: expect.any(Number),
      ports: { "app:9000": expect.any(Number) },
      optionen: [],
      einstellungen: { betreiber: {}, installation: { PROBE_TITEL: "Kanzlei" } },
      zustand: "wird_eingerichtet",
      health: {
        zustand: "unbekannt",
        grund: { code: "noch_keine_meldung", werte: {} },
        seit: null,
        gemeldetAm: null,
        units: [],
      },
      angelegtVon: technik.nutzerId,
      angelegtAm: server.jetzt(),
      geaendertAm: server.jetzt(),
    });
    const { daten: liste } = await json(support, "/api/v1/installationen");
    expect(liste.installationen).toContainEqual(i);
    const { daten: eine } = await json(support, `/api/v1/installationen/${i.installationId}`);
    expect(eine).toMatchObject({
      ...i,
      auftraege: [
        { aktion: EINRICHTUNG_AKTIONEN.einrichten, zustand: "zugestellt", fehler: null },
        { aktion: "pforte_route_setzen", zustand: "wartend", fehler: null },
      ],
      verlauf: [],
    });
    const eintrag = server.db
      .select()
      .from(auditLog)
      .all()
      .find((e) => e.ziel === `installationen:${i.installationId}`);
    expect(eintrag).toMatchObject({
      aktion: "installation.anlegen",
      akteur: technik.nutzerId,
      grund: "Auftrag vom 20.11.",
    });
  });

  it("needs a reason for every write", async () => {
    const { grund: _, ...ohne } = neu("ohne.kanzlei.example");
    expect(await json(teufel, "/api/v1/installationen", { body: ohne })).toEqual({
      status: 400,
      daten: { fehler: "ungueltig" },
    });
    const i = await anlegen(teufel, "grund.kanzlei.example");
    zustandSetzen(teufel.betreiberId, i.installationId, "gescheitert");
    expect(
      (
        await json(teufel, `/api/v1/installationen/${i.installationId}`, {
          method: "DELETE",
          body: {},
        })
      ).status,
    ).toBe(400);
  });

  it("is refused without the operator's required value, naming it", async () => {
    const a = await json(partner, "/api/v1/kunden", {
      body: {
        name: "Kunde des Partners",
        kontakt: { name: "Pia", email: "pia@kunde.test" },
        vertrag: { sla: "basis", beginn: BEGINN },
        grund: "Vertrag",
      },
    });
    const eigenerServer = await serverMitAgent(partner, []);
    const antwort = await json(partner, "/api/v1/installationen", {
      body: neu("partner.kanzlei.example", { kundeId: a.daten.id, serverId: eigenerServer }),
    });
    expect(antwort).toEqual({
      status: 409,
      daten: {
        fehler: "passt_nicht",
        gruende: [{ code: "betreiberwert_fehlt", werte: { name: "PROBE_LIZENZ" } }],
      },
    });
  });

  it("is removed only after its setup failed", async () => {
    const i = await anlegen(teufel, "weg.kanzlei.example");
    const pfad = `/api/v1/installationen/${i.installationId}`;
    expect(await json(teufel, pfad, { method: "DELETE", body: { grund: "weg" } })).toEqual({
      status: 409,
      daten: { fehler: "nicht_gescheitert" },
    });
    zustandSetzen(teufel.betreiberId, i.installationId, "gescheitert");
    const { status, daten } = await json(technik, pfad, {
      method: "DELETE",
      body: { grund: "weg" },
    });
    expect(status).toBe(200);
    expect(daten).toMatchObject({ zustand: "gescheitert" });
    expect((daten.auftraege as { aktion: string }[]).at(-1)).toMatchObject({
      aktion: EINRICHTUNG_AKTIONEN.entfernen,
      zustand: "zugestellt",
    });
  });

  it("is not made or removed by support", async () => {
    expect(
      await json(support, "/api/v1/installationen", { body: neu("support.kanzlei.example") }),
    ).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    const i = await anlegen(teufel, "support2.kanzlei.example");
    zustandSetzen(teufel.betreiberId, i.installationId, "gescheitert");
    expect(
      await json(support, `/api/v1/installationen/${i.installationId}`, {
        method: "DELETE",
        body: { grund: "weg" },
      }),
    ).toEqual({ status: 403, daten: { fehler: "keine_berechtigung" } });
  });
});

describe("no operator reaches another's installations", () => {
  let fremd: { installationId: string };

  beforeAll(async () => {
    fremd = await anlegen(teufel, "fremd.kanzlei.example");
    zustandSetzen(teufel.betreiberId, fremd.installationId, "gescheitert");
  });

  const unveraendert = () => {
    expect(server.db.select().from(installationen).all()).toContainEqual(
      expect.objectContaining({
        betreiberId: teufel.betreiberId,
        installationId: fremd.installationId,
        zustand: "gescheitert",
      }),
    );
    expect(
      server.db
        .select()
        .from(auditLog)
        .all()
        .filter(
          (e) => e.betreiberId === partner.betreiberId && e.ziel.includes(fremd.installationId),
        ),
    ).toEqual([]);
  };

  it("GET /api/v1/installationen lists one's own only", async () => {
    const { daten } = await json(partner, "/api/v1/installationen");
    expect(JSON.stringify(daten)).not.toContain(fremd.installationId);
    expect(JSON.stringify((await json(teufel, "/api/v1/installationen")).daten)).toContain(
      fremd.installationId,
    );
  });

  it("GET /api/v1/installationen/:installationId does not show another's", async () => {
    expect(await json(partner, `/api/v1/installationen/${fremd.installationId}`)).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
  });

  it("POST /api/v1/installationen/platzierung does not place on another's customer or server", async () => {
    expect(await json(partner, "/api/v1/installationen/platzierung", { body: wunsch() })).toEqual({
      status: 404,
      daten: { fehler: "kein_kunde" },
    });
  });

  it("POST /api/v1/installationen does not install for another's customer or on another's server", async () => {
    const vorher = server.db.select().from(installationen).all().length;
    expect(
      await json(partner, "/api/v1/installationen", { body: neu("x.kanzlei.example") }),
    ).toEqual({
      status: 404,
      daten: { fehler: "kein_kunde" },
    });
    expect(server.db.select().from(installationen).all().length).toBe(vorher);
    unveraendert();
  });

  it("DELETE /api/v1/installationen/:installationId does not remove another's", async () => {
    expect(
      await json(partner, `/api/v1/installationen/${fremd.installationId}`, {
        method: "DELETE",
        body: { grund: "fremd" },
      }),
    ).toEqual({ status: 404, daten: { fehler: "keine_installation" } });
    unveraendert();
  });
});

describe("the answers of the API", () => {
  it("carry no secret: not the operator's, not the installation's, no generated value", () => {
    const auto = agent
      .filter((n) => n.aktion === EINRICHTUNG_AKTIONEN.einrichten)
      .flatMap((n) =>
        Object.values(
          (n.einrichtung as { einstellungen: { auto: Record<string, string> } }).einstellungen.auto,
        ),
      );
    expect(auto.length).toBeGreaterThan(0);
    const text = JSON.stringify(antworten);
    for (const geheim of [LIZENZ, KENNWORT, ...auto]) expect(text).not.toContain(geheim);
    expect(text).not.toContain('geheim":');
  });
});

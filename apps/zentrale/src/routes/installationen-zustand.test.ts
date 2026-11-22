import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zustandAnnehmen } from "../modules/bewertung/index.ts";
import {
  eintrag,
  installationEinfuegen,
  kundeUndServer,
  zustandNachricht,
} from "../testhilfen/bewertung.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-403 over HTTP: the list and the page of installations give each one's state with
 * reason and since, the page its history; unknown 90 s after the last report; no operator sees
 * another's state or history, even of an installation of the same name (a test per endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

let server: TestServer;
let teufel: Person;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;

const json = async (p: Pick<Person, "json">, pfad: string) => (await p.json(pfad)) as Antwort;

/** The agent of the operator's server `s1` reports `e` now */
const melden = (betreiberId: string, ...e: ReturnType<typeof eintrag>[]) =>
  zustandAnnehmen(
    server.deps,
    { betreiberId, serverId: "s1" },
    zustandNachricht(e),
    server.jetzt(),
  );

/** An installation that runs on the operator's server `s1` */
const installation = (p: Person, installationId: string) =>
  installationEinfuegen(server.schreibDb, p.betreiberId, installationId, "s1");

const ausListe = async (p: Pick<Person, "json">, installationId: string) => {
  const { daten } = await json(p, "/api/v1/installationen");
  return (daten.installationen as { installationId: string }[]).find(
    (i) => i.installationId === installationId,
  );
};

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeUndServer(server.schreibDb, teufel.betreiberId, ["s1"]);
  kundeUndServer(server.schreibDb, partner.betreiberId, ["s1"]);
}, 60_000);

describe("the state of an installation over the API", () => {
  it("is in the list and on the page with reason and since, the page with its history", async () => {
    installation(teufel, "probe-zstand");
    const start = server.jetzt();
    melden(teufel.betreiberId, eintrag("probe-zstand"));
    server.stelleUhr(start + 30_000);
    melden(teufel.betreiberId, eintrag("probe-zstand", "gruen", "failed"));
    const health = {
      zustand: "gelb",
      grund: { code: "unit", werte: { unit: "probe-zstand-app.service", aktiv: "failed" } },
      seit: start + 30_000,
      gemeldetAm: start + 30_000,
      units: [{ name: "probe-zstand-app.service", aktiv: "failed" }],
    };
    expect(await ausListe(support, "probe-zstand")).toMatchObject({ health });
    expect((await json(support, "/api/v1/installationen/probe-zstand")).daten).toMatchObject({
      health,
      verlauf: [
        { zeitpunkt: start + 30_000, bewertung: "gelb", grund: health.grund },
        {
          zeitpunkt: start,
          bewertung: "gruen",
          grund: { code: "health", werte: { text: "HTTP 200" } },
        },
      ],
    });
  });

  it("is unknown 90 s after the last report, never green", async () => {
    installation(teufel, "probe-still1");
    const start = server.jetzt();
    melden(teufel.betreiberId, eintrag("probe-still1"));
    server.stelleUhr(start + 90_000);
    const { daten } = await json(teufel, "/api/v1/installationen/probe-still1");
    expect(daten.health).toMatchObject({
      zustand: "unbekannt",
      grund: { code: "keine_meldung", werte: {} },
      seit: start + 90_000,
      gemeldetAm: start,
    });
  });
});

describe("no operator sees another's state", () => {
  beforeAll(() => {
    installation(teufel, "probe-gleich");
    installation(partner, "probe-gleich");
    melden(teufel.betreiberId, eintrag("probe-gleich", "rot", "failed", "geheimer-grund"));
  });

  const unberuehrt = {
    zustand: "unbekannt",
    grund: { code: "noch_keine_meldung", werte: {} },
    seit: null,
    gemeldetAm: null,
    units: [],
  };

  it("GET /api/v1/installationen gives the partner its own installation of the same name", async () => {
    expect(await ausListe(partner, "probe-gleich")).toMatchObject({ health: unberuehrt });
    const { daten } = await json(partner, "/api/v1/installationen");
    expect(JSON.stringify(daten)).not.toContain("geheimer-grund");
    expect(await ausListe(teufel, "probe-gleich")).toMatchObject({ health: { zustand: "rot" } });
  });

  it("GET /api/v1/installationen/:installationId shows neither another's state nor its history", async () => {
    const { daten } = await json(partner, "/api/v1/installationen/probe-gleich");
    expect(daten).toMatchObject({ health: unberuehrt, verlauf: [] });
    expect(JSON.stringify(daten)).not.toContain("geheimer-grund");
    expect(await json(partner, "/api/v1/installationen/probe-zstand")).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
  });
});

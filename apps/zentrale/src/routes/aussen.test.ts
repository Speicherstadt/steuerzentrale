import type { Probe } from "@steuerzentrale/planung";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ergebnisAnnehmen, pfadVon } from "../modules/aussen/index.ts";
import type { Installation } from "../modules/installationen/index.ts";
import { installationLesen } from "../modules/installationen/index.ts";
import { installationEinfuegen, kundeUndServer } from "../testhilfen/bewertung.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-704 over HTTP: the page of an installation reads its check from outside and its
 * availability of 13 months; every role may; no operator sees another's, even of an installation
 * of the same name (a test per endpoint, CLAUDE.md).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Monat = { jahr: number; monat: number; gemessen: number; rot: number; anteil: number | null };
type Antwort = {
  aussen: { zustand: string; grund: { code: string }; ergebnis: Probe } | null;
  verfuegbarkeit: Monat[];
};

let server: TestServer;
let teufel: Person;
let mitglied: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;

const gut: Probe = {
  dns: { ok: true, a: ["203.0.113.10"], aaaa: [] },
  tls: { ok: true, gueltigBis: Date.UTC(2027, 0, 1) },
  http: { ok: true, status: 200, ms: 31 },
};

/** A check of the installation at the server's time with the answer `probe` */
const pruefen = (i: Installation, probe: Probe) => {
  const ziel = pfadVon(i.manifest);
  if (!ziel) throw new Error("no HTTP service");
  ergebnisAnnehmen(
    {
      db: server.db,
      schreibDb: server.schreibDb,
      now: server.jetzt,
      log: () => {},
      sonde: async () => probe,
    },
    { installation: i, ...ziel, soll: null },
    probe,
    server.jetzt(),
  );
};

const lesen = async (p: Pick<Person, "json">, id: string) => {
  const a = await p.json(`/api/v1/installationen/${id}/aussen`);
  return { status: a.status, daten: a.daten as Antwort };
};

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeUndServer(server.schreibDb, teufel.betreiberId, ["s1"]);
  kundeUndServer(server.schreibDb, partner.betreiberId, ["s1"]);
  installationEinfuegen(server.schreibDb, teufel.betreiberId, "probe-aussen", "s1");
  installationEinfuegen(server.schreibDb, partner.betreiberId, "probe-aussen", "s1");
}, 60_000);

describe("GET /api/v1/installationen/:id/aussen", () => {
  it("is null before the first check, with 13 months without a share", async () => {
    const { status, daten } = await lesen(mitglied, "probe-aussen");
    expect(status).toBe(200);
    expect(daten.aussen).toBeNull();
    expect(daten.verfuegbarkeit).toHaveLength(13);
    expect(daten.verfuegbarkeit.every((m) => m.anteil === null)).toBe(true);
  });

  it("gives the newest check with what each step answered and counts it into the month", async () => {
    const i = installationLesen(server.db, teufel.betreiberId, "probe-aussen");
    if (!i) throw new Error("missing");
    pruefen(i, gut);
    pruefen(i, { ...gut, http: { ok: true, status: 503, ms: 9 } });
    const { daten } = await lesen(mitglied, "probe-aussen");
    expect(daten.aussen).toMatchObject({
      zustand: "rot",
      grund: { code: "health", werte: { status: "503" } },
      ergebnis: { http: { status: 503 } },
    });
    expect(daten.verfuegbarkeit[0]).toMatchObject({ gemessen: 2, rot: 1, anteil: 0.5 });
  });

  it("shows no operator another's check, even of an installation of the same name", async () => {
    const { daten } = await lesen(partner, "probe-aussen");
    expect(daten.aussen).toBeNull();
    expect(daten.verfuegbarkeit[0]).toMatchObject({ gemessen: 0, anteil: null });
    const i = installationLesen(server.db, partner.betreiberId, "probe-aussen");
    if (!i) throw new Error("missing");
    pruefen(i, gut);
    expect((await lesen(partner, "probe-aussen")).daten.aussen?.zustand).toBe("gruen");
    expect((await lesen(teufel, "probe-aussen")).daten.aussen?.zustand).toBe("rot");
  });

  it("is 404 for an installation the operator does not have", async () => {
    installationEinfuegen(server.schreibDb, teufel.betreiberId, "probe-nur-teufel", "s1");
    expect((await lesen(partner, "probe-nur-teufel")).status).toBe(404);
    expect((await lesen(teufel, "probe-gibt-es-nicht")).status).toBe(404);
  });
});

type Tag = {
  jahr: number;
  monat: number;
  tag: number;
  gemessen: number;
  rot: number;
  anteil: number | null;
};

const tageHolen = async (p: Pick<Person, "json">, id: string, abfrage = "") => {
  const a = await p.json(`/api/v1/installationen/${id}/verfuegbarkeit${abfrage}`);
  return { status: a.status, daten: a.daten as { tage: Tag[] } };
};

// The bars of the app's tab "Messwerte": the same hourly counts per day in Berlin
describe("GET /api/v1/installationen/:id/verfuegbarkeit", () => {
  it("gives 90 days by default, oldest first, today with the checks of today", async () => {
    installationEinfuegen(server.schreibDb, teufel.betreiberId, "probe-tage", "s1");
    const i = installationLesen(server.db, teufel.betreiberId, "probe-tage");
    if (!i) throw new Error("missing");
    pruefen(i, gut);
    pruefen(i, { ...gut, http: { ok: true, status: 503, ms: 9 } });
    const { status, daten } = await tageHolen(mitglied, "probe-tage");
    expect(status).toBe(200);
    expect(daten.tage).toHaveLength(90);
    expect(daten.tage.at(-1)).toMatchObject({ gemessen: 2, rot: 1, anteil: 0.5 });
    expect(daten.tage.slice(0, -1).every((t) => t.anteil === null)).toBe(true);
    expect((await tageHolen(mitglied, "probe-tage", "?tage=7")).daten.tage).toHaveLength(7);
  });

  it("refuses a number of days that is not 1 to 400", async () => {
    for (const tage of ["0", "401", "x", "-1", "1.5"])
      expect((await tageHolen(teufel, "probe-tage", `?tage=${tage}`)).status).toBe(400);
  });

  it("shows no operator another's days, even of an installation of the same name", async () => {
    installationEinfuegen(server.schreibDb, partner.betreiberId, "probe-tage", "s1");
    const fremd = await tageHolen(partner, "probe-tage");
    expect(fremd.status).toBe(200);
    expect(fremd.daten.tage.every((t) => t.gemessen === 0)).toBe(true);
    expect((await tageHolen(teufel, "probe-tage")).daten.tage.at(-1)?.gemessen).toBe(2);
    installationEinfuegen(server.schreibDb, teufel.betreiberId, "probe-tage-teufel", "s1");
    expect((await tageHolen(partner, "probe-tage-teufel")).status).toBe(404);
  });
});

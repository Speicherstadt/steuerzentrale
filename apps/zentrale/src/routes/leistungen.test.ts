import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { instantVon } from "@steuerzentrale/planung";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schreiben } from "../modules/audit/index.ts";
import { auftragEinfuegen } from "../testhilfen/betrieb.ts";
import { installationEinfuegen, kundeUndServer } from "../testhilfen/bewertung.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-804 over HTTP: the services of each customer in a month, summed from what happened
 * (setup jobs, backup runs, support accesses, checks from outside), as JSON and as CSV after
 * RFC 4180; every role may read them; no operator sees another's, even of a customer and an
 * installation of the same name (a test per endpoint, CLAUDE.md).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Kunde = {
  kundeId: string;
  name: string;
  installationen: { installationId: string; app: string; speicherBytes: number | null }[];
  speicherBytes: number | null;
  supportMinuten: number;
  verfuegbarkeit: { anteil: number | null; gemessen: number };
};

const MIN = 60_000;
const STUNDE = 60 * MIN;
/** 10 November 2026, 10:00 in Berlin */
const MITTE = instantVon(2026, 11, 10, 10, 0);
const DEZEMBER = instantVon(2026, 12, 3, 9, 0);

let server: TestServer;
let teufel: Person;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;

const kontext = (betreiberId: string) => ({ betreiberId, akteur: "test", jetzt: 1, grund: "Test" });

/** What happened to an installation of `betreiberId` in November */
const november = (betreiberId: string, installationId: string, bytes: number, rot: number) => {
  auftragEinfuegen(server.schreibDb, betreiberId, "s1", {
    angelegtAm: MITTE - 30 * 24 * STUNDE,
    zustand: "erfolgreich",
    installationId,
    aktion: EINRICHTUNG_AKTIONEN.einrichten,
  });
  schreiben(server.schreibDb, kontext(betreiberId), "test", (w) => {
    w.einfuegen("verfuegbarkeit", {
      betreiberId,
      installationId,
      stunde: MITTE,
      gemessen: 60,
      rot,
    });
    w.einfuegen("backups", {
      betreiberId,
      backupId: `${installationId}-1`,
      installationId,
      serverId: "s1",
      zeitpunkt: MITTE,
      ok: true,
      teile: JSON.stringify([{ tag: "volume:daten", ok: true, snapshot: "a".repeat(64), bytes }]),
      gemeldetAm: MITTE,
    });
    w.einfuegen("supportZugaenge", {
      betreiberId,
      zugangId: `${installationId}-z`,
      installationId,
      nutzerId: "jemand",
      grund: "Test",
      beginn: MITTE,
      ende: MITTE + 2 * STUNDE,
      beendetAm: MITTE + 40 * MIN,
      beendetVon: "jemand",
    });
  });
};

const lesen = async (p: Pick<Person, "json">, abfrage: string) => {
  const a = await p.json(`/api/v1/leistungen${abfrage}`);
  return { status: a.status, daten: a.daten as { monat: string; kunden: Kunde[] } };
};

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeUndServer(server.schreibDb, teufel.betreiberId, ["s1"]);
  kundeUndServer(server.schreibDb, partner.betreiberId, ["s1"]);
  installationEinfuegen(server.schreibDb, teufel.betreiberId, "probe-l", "s1");
  installationEinfuegen(server.schreibDb, partner.betreiberId, "probe-l", "s1");
  november(teufel.betreiberId, "probe-l", 2048, 6);
  november(partner.betreiberId, "probe-l", 7, 60);
  // set up, but its setup failed: never the customer's
  installationEinfuegen(server.schreibDb, teufel.betreiberId, "probe-x", "s1");
  auftragEinfuegen(server.schreibDb, teufel.betreiberId, "s1", {
    angelegtAm: MITTE,
    zustand: "gescheitert",
    installationId: "probe-x",
    aktion: EINRICHTUNG_AKTIONEN.einrichten,
  });
  server.stelleUhr(DEZEMBER);
}, 60_000);

describe("GET /api/v1/leistungen", () => {
  it("sums each customer's month from what happened, for every role", async () => {
    const { status, daten } = await lesen(support, "?monat=2026-11");
    expect(status).toBe(200);
    expect(daten.monat).toBe("2026-11");
    expect(daten.kunden).toHaveLength(1);
    expect(daten.kunden[0]).toMatchObject({
      kundeId: "k1",
      name: "Kanzlei",
      installationen: [{ installationId: "probe-l", app: "probe", speicherBytes: 2048 }],
      speicherBytes: 2048,
      supportMinuten: 40,
      verfuegbarkeit: { anteil: 0.9, gemessen: 60 },
    });
  });

  it("takes the current month without one, and refuses a month that is none", async () => {
    const { daten } = await lesen(teufel, "");
    expect(daten.monat).toBe("2026-12");
    expect(daten.kunden[0]).toMatchObject({ supportMinuten: 0, speicherBytes: null });
    expect((await lesen(teufel, "?monat=2026-13")).status).toBe(400);
    expect((await lesen(teufel, "?monat=2026-11&format=xls")).status).toBe(400);
  });

  it("shows no operator another's customers, accesses, runs or checks", async () => {
    const { daten } = await lesen(partner, "?monat=2026-11");
    expect(daten.kunden).toHaveLength(1);
    expect(daten.kunden[0]).toMatchObject({
      speicherBytes: 7,
      supportMinuten: 40,
      verfuegbarkeit: { anteil: 0, gemessen: 60 },
    });
  });

  it("exports the month as CSV after RFC 4180, a download named by the month", async () => {
    const r = await teufel.anfrage("/api/v1/leistungen?monat=2026-11&format=csv");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8; header=present");
    expect(r.headers.get("content-disposition")).toBe(
      'attachment; filename="leistungen-2026-11.csv"',
    );
    expect(await r.text()).toBe(
      [
        "monat,kunde,kuerzel,installationen,apps,speicher_bytes,support_minuten,verfuegbarkeit_prozent,gemessene_minuten,minuten",
        "2026-11,Kanzlei,kanzlei,1,probe,2048,40,90.00,60,43200",
        "",
      ].join("\r\n"),
    );
    const fremd = await (
      await partner.anfrage("/api/v1/leistungen?monat=2026-11&format=csv")
    ).text();
    expect(fremd).toContain(",7,40,0.00,60,");
    expect(fremd).not.toContain("2048");
  });
});

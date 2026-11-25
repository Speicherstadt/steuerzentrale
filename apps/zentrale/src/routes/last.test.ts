import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { faktenAnfuegen } from "../modules/audit/index.ts";
import { installationEinfuegen, kundeUndServer } from "../testhilfen/bewertung.ts";
import { FAKTEN } from "../testhilfen/installationen.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-1106 over HTTP: CPU, load and memory of a server and of an installation's Linux
 * user, per hour the highest reading, from the history of the server's facts; every role reads; no
 * operator sees another's (a test per endpoint, CLAUDE.md).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;

let server: TestServer;
let teufel: Person;
let mitglied: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;

const fakten = (zeitpunkt: number, cpu: number, belegt: number, nutzerRam: number) =>
  faktenAnfuegen(server.schreibDb, {
    betreiberId: teufel.betreiberId,
    serverId: "s1",
    zeitpunkt,
    daten: JSON.stringify({
      ...FAKTEN,
      ramMb: 8000,
      last: {
        cpuProzent: cpu,
        last1: 0.7,
        ramBelegtMb: belegt,
        nutzer: [{ name: "sz-i1", cpuProzent: cpu / 2, ramMb: nutzerRam }],
      },
    }),
  });

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeUndServer(server.schreibDb, teufel.betreiberId, ["s1"]);
  installationEinfuegen(server.schreibDb, teufel.betreiberId, "i1", "s1");
  const stunde = Math.floor(server.jetzt() / 3_600_000) * 3_600_000;
  fakten(stunde, 20, 2000, 300);
  fakten(stunde + 60_000, 60, 4000, 200);
}, 60_000);

describe("CPU, load and memory (Z-1106)", () => {
  it("of a server, per hour the highest reading, for every role", async () => {
    for (const wer of [teufel, mitglied]) {
      const r = await wer.json("/api/v1/server/s1/last?tage=1");
      expect(r).toEqual({
        status: 200,
        daten: {
          stunden: [{ stunde: expect.any(Number), cpuProzent: 60, last1: 0.7, ramProzent: 50 }],
        },
      });
    }
    expect((await teufel.json("/api/v1/server/s1/last?tage=0")).status).toBe(400);
  });

  it("of an installation's Linux user", async () => {
    expect(await mitglied.json("/api/v1/installationen/i1/last?tage=7")).toEqual({
      status: 200,
      daten: { stunden: [{ stunde: expect.any(Number), cpuProzent: 30, ramMb: 300 }] },
    });
  });

  it("of another operator's server or installation is not found", async () => {
    expect((await partner.json("/api/v1/server/s1/last")).status).toBe(404);
    expect((await partner.json("/api/v1/installationen/i1/last")).status).toBe(404);
  });
});

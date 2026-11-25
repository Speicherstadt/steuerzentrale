import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vertraege } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { kundeAnlegen, serverMitAgent } from "../testhilfen/installationen-api.ts";
import { laufendeInstallation } from "../testhilfen/laufend.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-604 over HTTP: every role reads where an installation stands after its contract;
 * the link to the archive only owner and inhaber2 with a reason, refused while there is no archive;
 * no operator reaches another's installation (a test per endpoint). The link itself, its time and
 * its refusal afterwards are tested in modules/abwicklung against the stand-in of MinIO.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

let server: TestServer;
let teufel: Person;
let inhaber2: Awaited<ReturnType<TestServer["eingeladen"]>>;
let mitglied: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
let id = "";
const agent: Record<string, unknown>[] = [];

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
): Promise<Antwort> => (await p.json(pfad, init)) as Antwort;

const link = (p: Pick<Person, "json">, body: Record<string, unknown> = { grund: "Kunde fragt" }) =>
  json(p, `/api/v1/installationen/${id}/archiv-link`, { body });

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  inhaber2 = await server.eingeladen(teufel, "inhaber");
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  const kundeId = await kundeAnlegen(json, teufel);
  const serverId = await serverMitAgent(server, json, teufel, agent);
  id = await laufendeInstallation(
    server,
    json,
    teufel,
    { kundeId, serverId },
    "probe",
    "ende.kanzlei.test",
  );
}, 60_000);

describe("after the contract's end over HTTP", () => {
  it("shows every role where the installation stands", async () => {
    for (const p of [teufel, inhaber2, mitglied]) {
      const r = await json(p, `/api/v1/installationen/${id}/abwicklung`);
      expect(r).toMatchObject({
        status: 200,
        daten: { phase: "laeuft", vertragsende: null, schritt: null, archiv: null },
      });
    }
  });

  it("lets owner and inhaber2 ask for a link with a reason, none without an archive", async () => {
    expect((await link(teufel)).daten).toEqual({ fehler: "kein_archiv" });
    expect((await link(inhaber2)).status).toBe(409);
    expect((await link(mitglied)).status).toBe(403);
    expect(await link(teufel, {})).toEqual({ status: 409, daten: { fehler: "kein_archiv" } });
  });

  it("names the phase and deadlines once the contract ended", async () => {
    const ende = Date.UTC(2026, 0, 14, 23);
    const vertrag = server.db.select().from(vertraege).all()[0];
    schreiben(
      server.schreibDb,
      { betreiberId: teufel.betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
      "test",
      (w) => w.aendern("vertraege", { vertragId: vertrag?.vertragId ?? "" }, { ende }),
    );
    const r = await json(teufel, `/api/v1/installationen/${id}/abwicklung`);
    expect(r.daten).toMatchObject({
      vertragsende: ende,
      nurLesenBis: Date.UTC(2026, 1, 13, 23),
      loeschenAb: Date.UTC(2026, 3, 14, 22),
    });
  });

  it("lets no operator reach another's installation", async () => {
    expect((await json(partner, `/api/v1/installationen/${id}/abwicklung`)).status).toBe(404);
    expect((await link(partner)).daten).toEqual({ fehler: "keine_installation" });
  });
});

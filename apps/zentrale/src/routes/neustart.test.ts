import { SERVER_NEUSTART_AKTION } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, auftraege } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { FAKTEN, KENNWORT, LIZENZ } from "../testhilfen/installationen.ts";
import {
  kundeAnlegen,
  manifestHochladen,
  serverMitAgent,
} from "../testhilfen/installationen-api.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-701 over HTTP (docs/plan.md, "Neustart von Hand"): every server in the API says
 * whether it needs a reboot, what the plan decides and its last reboot; owner and inhaber2 reboot a
 * server by hand with a reason, at any time but never in a freeze window of an app on it and never
 * beside an open job; mitglied only reads; no operator reaches another's server (a test per
 * endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

let server: TestServer;
let teufel: Person;
let inhaber2: Awaited<ReturnType<TestServer["eingeladen"]>>;
let mitglied: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
let kundeId: string;
let serverId: string;
let partnerServer: string;
const agent: Record<string, unknown>[] = [];
const partnerAgent: Record<string, unknown>[] = [];

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
): Promise<Antwort> => (await p.json(pfad, init)) as Antwort;

const neustart = (p: Pick<Person, "json">, id: string, grund?: unknown) =>
  json(p, `/api/v1/server/${id}/neustart`, { body: grund === undefined ? {} : { grund } });

const kontext = (p: Person) => ({
  betreiberId: p.betreiberId,
  akteur: "test",
  jetzt: server.jetzt(),
  grund: "Test",
});

/** Every job of the operator done, as its agents would have reported */
const allesErledigt = (p: Person) =>
  schreiben(server.schreibDb, kontext(p), "test", (w) => {
    for (const a of server.db.select().from(auftraege).all())
      if (a.betreiberId === p.betreiberId)
        w.aendern("auftraege", { auftragId: a.auftragId }, { zustand: "erfolgreich" });
  });

const beigetreten = (p: Person, id: string) =>
  schreiben(server.schreibDb, kontext(p), "test", (w) =>
    w.aendern("server", { serverId: id }, { beigetretenAm: server.jetzt() }),
  );

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  inhaber2 = await server.eingeladen(teufel, "inhaber");
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeId = await kundeAnlegen(json, teufel);
  serverId = await serverMitAgent(server, json, teufel, agent);
  partnerServer = await serverMitAgent(server, json, partner, partnerAgent);
  beigetreten(teufel, serverId);
  beigetreten(partner, partnerServer);
}, 60_000);

describe("the reboot of a server", () => {
  it("is shown at every server: needed, what the plan decides, the last one", async () => {
    allesErledigt(teufel);
    const r = await json(mitglied, `/api/v1/server/${serverId}`);
    expect(r.status).toBe(200);
    expect(r.daten.fakten).toMatchObject({
      bootId: FAKTEN.bootId,
      unattendedUpgrades: { installiert: true, aktiv: true },
      updatesAusstehend: 3,
      neustartNoetig: true,
    });
    // outside the window of Sundays 03:00–04:00: it waits for it
    expect(r.daten.neustart).toEqual({
      noetig: true,
      plan: { art: "warten", grund: "fenster", ab: expect.any(Number) },
      letzter: null,
    });
    const liste = await json(mitglied, "/api/v1/server");
    expect((liste.daten.server as Record<string, unknown>[])[0]?.neustart).toEqual(
      r.daten.neustart,
    );
  });

  it("by hand: backups first, the reboot with the reason in the audit log", async () => {
    allesErledigt(teufel);
    const vorher = agent.length;
    const r = await neustart(inhaber2, serverId, "Kernel-Update, Kunde informiert");
    expect(r).toMatchObject({
      status: 201,
      daten: {
        backups: [],
        neustart: { aktion: SERVER_NEUSTART_AKTION, zustand: "zugestellt", installationId: null },
      },
    });
    const auftragId = (r.daten.neustart as { auftragId: string }).auftragId;
    expect(agent.slice(vorher)).toEqual([
      expect.objectContaining({ auftragId, argumente: { bootId: FAKTEN.bootId } }),
    ]);
    expect(server.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({
        aktion: "server.neustart",
        ziel: `auftraege:${auftragId}`,
        grund: "Kernel-Update, Kunde informiert",
      }),
    );
    const stand = (await json(teufel, `/api/v1/server/${serverId}`)).daten.neustart;
    expect(stand).toMatchObject({
      plan: { art: "warten", grund: "auftraege" },
      letzter: { auftragId, zustand: "zugestellt", vonHand: true, fehler: null },
    });
    // one at a time on a server
    expect(await neustart(teufel, serverId, "noch einmal")).toEqual({
      status: 409,
      daten: { fehler: "auftrag_offen" },
    });
  });

  it("is refused without a reason and for mitglied", async () => {
    allesErledigt(teufel);
    for (const grund of [undefined, "", "   "])
      expect(await neustart(teufel, serverId, grund)).toEqual({
        status: 400,
        daten: { fehler: "ungueltig" },
      });
    expect((await neustart(mitglied, serverId, "darf nicht")).status).toBe(403);
  });

  it("is refused in a freeze window of an app on the server, also for the owner", async () => {
    allesErledigt(teufel);
    const a = await json(teufel, "/api/v1/installationen", {
      body: {
        kundeId,
        serverId,
        ...(await manifestHochladen(json, teufel, "gesperrt")),
        optionen: [],
        host: "sperre.kanzlei.test",
        einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
        betreiberWerte: { PROBE_LIZENZ: LIZENZ },
        grund: "Auftrag",
      },
    });
    expect(a.status).toBe(201);
    allesErledigt(teufel);
    // 08.02.2027, inside the freeze window from the 7th to the 12th
    const vorher = server.jetzt();
    server.stelleUhr(Date.UTC(2027, 1, 8, 10));
    try {
      expect(await neustart(teufel, serverId, "dringend")).toEqual({
        status: 409,
        daten: { fehler: "sperrzeit", detail: "Umsatzsteuer-Voranmeldung" },
      });
      const stand = (await json(teufel, `/api/v1/server/${serverId}`)).daten.neustart;
      expect(stand).toMatchObject({ plan: { art: "warten", grund: "sperrzeit" } });
    } finally {
      server.stelleUhr(vorher);
    }
  });

  it("of another operator's server is unknown, and the other operator sees none of it", async () => {
    allesErledigt(teufel);
    allesErledigt(partner);
    expect(await neustart(teufel, partnerServer, "fremd")).toEqual({
      status: 404,
      daten: { fehler: "kein_server" },
    });
    expect(partnerAgent.filter((n) => n.aktion === SERVER_NEUSTART_AKTION)).toEqual([]);
    expect(await neustart(partner, serverId, "fremd")).toEqual({
      status: 404,
      daten: { fehler: "kein_server" },
    });
    expect((await json(partner, `/api/v1/server/${serverId}`)).status).toBe(404);
    const r = await neustart(partner, partnerServer, "eigener Server");
    expect(r.status).toBe(201);
    const partnerStand = (await json(partner, `/api/v1/server/${partnerServer}`)).daten.neustart;
    expect(partnerStand).toMatchObject({ letzter: { vonHand: true } });
    // the owner's list holds only the owner's servers and reboots
    const liste = (await json(teufel, "/api/v1/server")).daten.server as { serverId: string }[];
    expect(liste.map((s) => s.serverId)).toEqual([serverId]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, auftraege, ereignisse, supportZugaenge } from "../db/schema.ts";
import { logAuszugAnnehmen } from "../modules/auftraege/log-auszug.ts";
import { abgelaufeneMelden } from "../modules/support/index.ts";
import { kundeAnlegen, serverMitAgent } from "../testhilfen/installationen-api.ts";
import { allesErledigt, laufendeInstallation } from "../testhilfen/laufend.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-802 over HTTP: a support access, started by a member for itself on one
 * installation with a reason, for 2 hours unless it names another duration (at most 4); while it
 * runs, support takes log excerpts and restarts that installation; once it ran out or was ended,
 * every one of these is refused, checked at each request against the clock; start and end stand in
 * the audit log with their reason and in the events of the installation, which the customer's page
 * shows; no operator sees or ends another's accesses.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

const MINUTE = 60_000;
const STUNDE = 60 * MINUTE;
const ZUGAENGE = "/api/v1/support-zugaenge";

let server: TestServer;
let teufel: Person;
let technik: Awaited<ReturnType<TestServer["eingeladen"]>>;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
let kundeId: string;
let serverId: string;
const agent: Record<string, unknown>[] = [];

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
): Promise<Antwort> => (await p.json(pfad, init)) as Antwort;

const laufend = (host: string, ort = { kundeId, serverId }) =>
  laufendeInstallation(server, json, teufel, ort, "probe", host);

const starten = (p: Pick<Person, "json">, body: Record<string, unknown>) =>
  json(p, ZUGAENGE, { body });

/** Starts an access as `p` and returns its id */
const gestartet = async (p: Pick<Person, "json">, installationId: string, grund = "Anfrage") => {
  const r = await starten(p, { installationId, grund });
  if (r.status !== 201) throw new Error(`starten ${r.status} ${JSON.stringify(r.daten)}`);
  return String(r.daten.zugangId);
};

const aktion = (p: Pick<Person, "json">, id: string, was: "neustart" | "log-auszug") =>
  json(p, `/api/v1/installationen/${id}/${was}`, { body: { grund: "Kunde meldet Fehler" } });

const zeilenLesen = (p: Pick<Person, "json">, id: string, auftragId: string) =>
  json(p, `/api/v1/installationen/${id}/log-auszuege/${auftragId}`);

const beenden = (p: Pick<Person, "json">, zugangId: string) =>
  json(p, `${ZUGAENGE}/${zugangId}/beenden`, { body: {} });

const verweigert = { status: 403, daten: { fehler: "keine_berechtigung" } };

/** The clock only moves forward, so an access started in one test never comes back in another */
const spaeter = (ms: number) => server.stelleUhr(server.jetzt() + ms);

const ereignisseZu = (installationId: string) =>
  server.db
    .select()
    .from(ereignisse)
    .all()
    .filter((e) => e.ziel === `installation:${installationId}`);

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  technik = await server.eingeladen(teufel, "technik");
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeId = await kundeAnlegen(json, teufel);
  serverId = await serverMitAgent(server, json, teufel, agent);
}, 60_000);

describe("starting a support access", () => {
  it("lasts 2 hours, with its reason in the audit log and an event of the installation", async () => {
    const id = await laufend("start.kanzlei.test");
    const jetzt = server.jetzt();
    const r = await starten(support, { installationId: id, grund: "Backup schlägt fehl" });
    expect(r).toMatchObject({
      status: 201,
      daten: {
        installationId: id,
        kundeId,
        grund: "Backup schlägt fehl",
        beginn: jetzt,
        ende: jetzt + 2 * STUNDE,
        beendetAm: null,
        aktiv: true,
        eigen: true,
        nutzer: { name: "Person support" },
        aktionen: [],
      },
    });
    const zugangId = String(r.daten.zugangId);
    expect(server.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({
        betreiberId: teufel.betreiberId,
        akteur: support.nutzerId,
        aktion: "support.starten",
        ziel: `supportZugaenge:${zugangId}`,
        grund: "Backup schlägt fehl",
      }),
    );
    expect(ereignisseZu(id)).toContainEqual(
      expect.objectContaining({
        art: "support_zugang",
        schwere: "info",
        zeitpunkt: jetzt,
        text: "Support-Zugang gestartet: Person support, 2 h, „Backup schlägt fehl“",
      }),
    );
  });

  it("takes another duration of 15 minutes to 4 hours", async () => {
    const id = await laufend("dauer.kanzlei.test");
    const r = await starten(support, { installationId: id, grund: "kurz", dauerMinuten: 240 });
    expect(r.status).toBe(201);
    expect(Number(r.daten.ende) - Number(r.daten.beginn)).toBe(4 * STUNDE);
    for (const dauerMinuten of [14, 241, 1.5, "120"])
      expect(await starten(technik, { installationId: id, grund: "x", dauerMinuten })).toEqual({
        status: 400,
        daten: { fehler: "ungueltig" },
      });
  });

  it("is refused without a reason, for an unknown installation and twice at once", async () => {
    const id = await laufend("doppelt.kanzlei.test");
    for (const grund of [undefined, "", "   "])
      expect(await starten(support, { installationId: id, grund })).toEqual({
        status: 400,
        daten: { fehler: "ungueltig" },
      });
    expect(await starten(support, { installationId: "gibt-es-nicht", grund: "x" })).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
    await gestartet(support, id);
    expect(await starten(support, { installationId: id, grund: "noch einer" })).toEqual({
      status: 409,
      daten: { fehler: "zugang_aktiv" },
    });
    // another member's access to the same installation is its own
    expect((await starten(technik, { installationId: id, grund: "mit dabei" })).status).toBe(201);
    expect(
      server.db
        .select()
        .from(supportZugaenge)
        .all()
        .filter((z) => z.installationId === id),
    ).toHaveLength(2);
  });
});

describe("while an access runs", () => {
  it("support takes log excerpts, reads their lines and restarts that installation", async () => {
    const id = await laufend("waehrend.kanzlei.test");
    const andere = await laufend("andere.kanzlei.test");
    expect(await aktion(support, id, "log-auszug")).toEqual(verweigert);
    expect(await aktion(support, id, "neustart")).toEqual(verweigert);
    await gestartet(support, id, "Anmeldung langsam");

    const log = await aktion(support, id, "log-auszug");
    expect(log.status).toBe(201);
    const auftragId = (log.daten.auftrag as { auftragId: string }).auftragId;
    const meldung = { typ: "log_auszug" as const, protokoll: 1, auftragId, zeilen: ["a"] };
    logAuszugAnnehmen(server.deps, { betreiberId: teufel.betreiberId, serverId }, meldung, 5);
    expect(await zeilenLesen(support, id, auftragId)).toMatchObject({
      status: 200,
      daten: { zeilen: ["a"] },
    });
    allesErledigt(server, teufel.betreiberId, id);
    expect((await aktion(support, id, "neustart")).status).toBe(201);
    // the access opens this installation only, and never "nur lesen"
    expect(await aktion(support, andere, "log-auszug")).toEqual(verweigert);
    expect(
      await json(support, `/api/v1/installationen/${id}/nur-lesen`, { body: { grund: "x" } }),
    ).toEqual(verweigert);
  });

  it("lists what was done during it", async () => {
    const id = await laufend("liste.kanzlei.test");
    const zugangId = await gestartet(support, id);
    expect((await aktion(support, id, "log-auszug")).status).toBe(201);
    allesErledigt(server, teufel.betreiberId, id);
    // owner's own restart does not count for support's access
    expect((await aktion(teufel, id, "neustart")).status).toBe(201);
    const { daten } = await json(teufel, `${ZUGAENGE}?installationId=${id}`);
    expect(daten.zugaenge).toEqual([
      expect.objectContaining({ zugangId, aktionen: ["log_auszug"], eigen: false, aktiv: true }),
    ]);
  });
});

describe("after an access ran out", () => {
  it("refuses every request it allowed, also at the very millisecond of its end", async () => {
    const id = await laufend("ablauf.kanzlei.test");
    await gestartet(support, id);
    const log = await aktion(support, id, "log-auszug");
    const auftragId = (log.daten.auftrag as { auftragId: string }).auftragId;
    allesErledigt(server, teufel.betreiberId, id);
    spaeter(2 * STUNDE - 1);
    expect((await zeilenLesen(support, id, auftragId)).status).toBe(200);
    spaeter(1);
    expect(await aktion(support, id, "log-auszug")).toEqual(verweigert);
    expect(await aktion(support, id, "neustart")).toEqual(verweigert);
    expect(await zeilenLesen(support, id, auftragId)).toEqual(verweigert);
    const { daten } = await json(support, `${ZUGAENGE}?installationId=${id}`);
    expect(daten.zugaenge).toEqual([expect.objectContaining({ aktiv: false, beendetAm: null })]);
    // owner and technik keep their own rights
    expect((await zeilenLesen(technik, id, auftragId)).status).toBe(200);
  });

  it("refuses a request whose body arrives only after the access ran out", async () => {
    const id = await laufend("langsam.kanzlei.test");
    const zugangId = await gestartet(support, id);
    const ende = Number(
      server.db
        .select()
        .from(supportZugaenge)
        .all()
        .find((z) => z.zugangId === zugangId)?.ende,
    );
    spaeter(ende - 1 - server.jetzt());
    // the headers of support's browser, taken from one request it sends
    const app = server.app;
    const request = app.request.bind(app);
    let kopf = new Headers();
    app.request = ((pfad: string, init: RequestInit) => {
      kopf = new Headers(init.headers);
      return request(pfad, init);
    }) as typeof app.request;
    await json(support, ZUGAENGE);
    app.request = request;
    // the guard sees the request while the access runs; its body comes ten minutes later
    const koerper = new ReadableStream<Uint8Array>(
      {
        pull: (strom) => {
          spaeter(10 * MINUTE);
          strom.enqueue(new TextEncoder().encode(JSON.stringify({ grund: "spät" })));
          strom.close();
        },
      },
      { highWaterMark: 0 },
    );
    const antwort = await request(`http://localhost:28300/api/v1/installationen/${id}/neustart`, {
      method: "POST",
      headers: kopf,
      body: koerper,
      duplex: "half",
    } as RequestInit);
    expect(antwort.status).toBe(403);
    expect(
      server.db
        .select()
        .from(auftraege)
        .all()
        .filter((a) => a.installationId === id && a.angelegtAm >= ende),
    ).toEqual([]);
  });

  it("writes one event of its end, at the instant it ran out", async () => {
    const id = await laufend("ende.kanzlei.test");
    const beginn = server.jetzt();
    await gestartet(support, id, "Kunde ruft an");
    spaeter(2 * STUNDE + 5 * MINUTE);
    expect(abgelaufeneMelden(server.db, server.schreibDb, server.jetzt())).toBeGreaterThan(0);
    expect(abgelaufeneMelden(server.db, server.schreibDb, server.jetzt())).toBe(0);
    expect(ereignisseZu(id).filter((e) => e.art === "support_zugang_ende")).toEqual([
      expect.objectContaining({
        zeitpunkt: beginn + 2 * STUNDE,
        schwere: "info",
        text: "Support-Zugang abgelaufen: Person support nach 2 h",
      }),
    ]);
  });
});

describe("ending an access early", () => {
  it("is open to its holder and refuses every request after it", async () => {
    const id = await laufend("beenden.kanzlei.test");
    const zugangId = await gestartet(support, id);
    spaeter(30 * MINUTE);
    expect(await beenden(support, zugangId)).toMatchObject({
      status: 200,
      daten: { zugangId, aktiv: false, beendetAm: server.jetzt() },
    });
    expect(await aktion(support, id, "log-auszug")).toEqual(verweigert);
    expect(await beenden(support, zugangId)).toEqual({
      status: 409,
      daten: { fehler: "zugang_beendet" },
    });
    expect(ereignisseZu(id)).toContainEqual(
      expect.objectContaining({
        art: "support_zugang_ende",
        text: "Support-Zugang beendet: Person support nach 30 Min.",
      }),
    );
    expect(server.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({
        akteur: support.nutzerId,
        aktion: "support.beenden",
        ziel: `supportZugaenge:${zugangId}`,
      }),
    );
    // ended by hand, the loop makes no second event
    abgelaufeneMelden(server.db, server.schreibDb, server.jetzt() + 3 * STUNDE);
    expect(ereignisseZu(id).filter((e) => e.art === "support_zugang_ende")).toHaveLength(1);
  });

  it("is open to owner and technik for another's access, not to support", async () => {
    const id = await laufend("fremd-beenden.kanzlei.test");
    const vonTechnik = await gestartet(technik, id);
    const vonSupport = await gestartet(support, id);
    expect(await beenden(support, vonTechnik)).toEqual(verweigert);
    expect((await beenden(teufel, vonSupport)).status).toBe(200);
    expect((await beenden(teufel, vonTechnik)).status).toBe(200);
  });
});

describe("no operator reaches another's support accesses", () => {
  it("GET /api/v1/support-zugaenge lists one's own only", async () => {
    const id = await laufend("mandant-liste.kanzlei.test");
    const zugangId = await gestartet(support, id);
    expect((await json(partner, ZUGAENGE)).daten).toEqual({ zugaenge: [] });
    expect((await json(partner, `${ZUGAENGE}?installationId=${id}`)).daten).toEqual({
      zugaenge: [],
    });
    expect(JSON.stringify((await json(teufel, ZUGAENGE)).daten)).toContain(zugangId);
  });

  it("POST /api/v1/support-zugaenge does not start one on another's installation", async () => {
    const id = await laufend("mandant-start.kanzlei.test");
    expect(await starten(partner, { installationId: id, grund: "fremd" })).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
  });

  it("POST /api/v1/support-zugaenge/:zugangId/beenden does not end another's", async () => {
    const id = await laufend("mandant-ende.kanzlei.test");
    const zugangId = await gestartet(support, id);
    expect(await beenden(partner, zugangId)).toEqual({
      status: 404,
      daten: { fehler: "kein_zugang" },
    });
    expect((await aktion(support, id, "log-auszug")).status).toBe(201);
  });
});

describe("the list", () => {
  it("narrows to one customer's accesses, newest first", async () => {
    const andererKunde = await kundeAnlegen(json, teufel, "Praxis Süd");
    const id = await laufend("kunde-a.kanzlei.test");
    const anderswo = await laufend("kunde-b.kanzlei.test", { kundeId: andererKunde, serverId });
    const erster = await gestartet(support, anderswo);
    spaeter(MINUTE);
    const zweiter = await gestartet(technik, anderswo);
    await gestartet(support, id);
    const { daten } = await json(support, `${ZUGAENGE}?kundeId=${andererKunde}`);
    expect((daten.zugaenge as { zugangId: string }[]).map((z) => z.zugangId)).toEqual([
      zweiter,
      erster,
    ]);
  });
});

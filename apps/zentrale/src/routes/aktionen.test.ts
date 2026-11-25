import { AKTIONS_AUFTRAEGE } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, auftraege } from "../db/schema.ts";
import { logAuszugAnnehmen } from "../modules/auftraege/log-auszug.ts";
import { kundeAnlegen, serverMitAgent } from "../testhilfen/installationen-api.ts";
import { allesErledigt as erledigt, laufendeInstallation } from "../testhilfen/laufend.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-405 over HTTP: restart, log excerpt and "nur lesen" of an installation, each with a
 * reason in the audit log, only when its manifest offers it; owner and inhaber2 trigger all three,
 * mitglied the log excerpt and the restart only during a mitglied access (Z-802, routes/mitglied.test.ts);
 * a restart never in a freeze window and never beside an open job; no operator reaches another's
 * actions or log excerpts (a test per endpoint).
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
const agent: Record<string, unknown>[] = [];

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
): Promise<Antwort> => (await p.json(pfad, init)) as Antwort;

const pfad = (id: string, aktion: string) => `/api/v1/installationen/${id}/${aktion}`;
const logPfad = (id: string, auftragId: string) =>
  `/api/v1/installationen/${id}/log-auszuege/${auftragId}`;

const ausloesen = (p: Pick<Person, "json">, id: string, aktion: string, grund?: unknown) =>
  json(p, pfad(id, aktion), { body: grund === undefined ? {} : { grund } });

const allesErledigt = (installationId: string) =>
  erledigt(server, teufel.betreiberId, installationId);

/** A running installation of Teufel IT from one of the test manifests; its id */
const laufend = (app: "probe" | "aktionen" | "gesperrt", host: string) =>
  laufendeInstallation(server, json, teufel, { kundeId, serverId }, app, host);

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  inhaber2 = await server.eingeladen(teufel, "inhaber");
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeId = await kundeAnlegen(json, teufel);
  serverId = await serverMitAgent(server, json, teufel, agent);
}, 60_000);

describe("the actions of an installation", () => {
  it("are listed on its page as its manifest offers them", async () => {
    const probe = await laufend("probe", "angebot-a.kanzlei.test");
    const aktionen = await laufend("aktionen", "angebot-b.kanzlei.test");
    expect((await json(mitglied, `/api/v1/installationen/${probe}`)).daten.aktionen).toEqual({
      neustart: true,
      log_auszug: true,
      nur_lesen: false,
    });
    expect((await json(mitglied, `/api/v1/installationen/${aktionen}`)).daten.aktionen).toEqual({
      neustart: false,
      log_auszug: true,
      nur_lesen: true,
    });
  });

  it("become jobs with their reason in the audit log", async () => {
    const id = await laufend("aktionen", "audit.kanzlei.test");
    const r = await ausloesen(inhaber2, id, "nur-lesen", "Vertrag endet");
    expect(r).toMatchObject({
      status: 201,
      daten: { auftrag: { aktion: "nurlesen", zustand: "zugestellt" } },
    });
    const auftragId = (r.daten.auftrag as { auftragId: string }).auftragId;
    expect(agent.at(-1)).toMatchObject({ typ: "auftrag", auftragId, aktion: "nurlesen" });
    expect(server.db.select().from(auditLog).all()).toContainEqual(
      expect.objectContaining({
        aktion: "installation.nur_lesen",
        ziel: `auftraege:${auftragId}`,
        grund: "Vertrag endet",
      }),
    );
  });

  it.each(["neustart", "log-auszug", "nur-lesen"])("%s is refused without a reason", async (a) => {
    const id = await laufend("aktionen", `ohne-${a}.kanzlei.test`);
    const vorher = server.db.select().from(auftraege).all().length;
    for (const grund of [undefined, "", "   "])
      expect(await ausloesen(teufel, id, a, grund)).toEqual({
        status: 400,
        daten: { fehler: "ungueltig" },
      });
    expect(server.db.select().from(auftraege).all()).toHaveLength(vorher);
  });

  it("is refused when its manifest does not offer it", async () => {
    const aktionen = await laufend("aktionen", "nicht-a.kanzlei.test");
    const probe = await laufend("probe", "nicht-b.kanzlei.test");
    expect(await ausloesen(teufel, aktionen, "neustart", "Health rot")).toEqual({
      status: 422,
      daten: { fehler: "nicht_angeboten" },
    });
    expect(await ausloesen(teufel, probe, "nur-lesen", "Vertrag endet")).toEqual({
      status: 422,
      daten: { fehler: "nicht_angeboten" },
    });
  });

  it("lets a member restart and take a log excerpt, never „nur lesen“ (Z-1204)", async () => {
    const id = await laufend("probe", "mitglied.kanzlei.test");
    expect(await ausloesen(mitglied, id, "nur-lesen", "Anfrage")).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    expect((await ausloesen(mitglied, id, "log-auszug", "Anfrage")).status).toBe(201);
    allesErledigt(id);
    expect((await ausloesen(mitglied, id, "neustart", "Health rot")).status).toBe(201);
  });
});

describe("a restart", () => {
  it("is refused while another job of the installation is open", async () => {
    const id = await laufend("probe", "offen.kanzlei.test");
    expect((await ausloesen(teufel, id, "log-auszug", "erst lesen")).status).toBe(201);
    expect(await ausloesen(teufel, id, "neustart", "dann neu starten")).toEqual({
      status: 409,
      daten: { fehler: "auftrag_offen" },
    });
    allesErledigt(id);
    expect(await ausloesen(teufel, id, "neustart", "dann neu starten")).toMatchObject({
      status: 201,
      daten: { auftrag: { aktion: AKTIONS_AUFTRAEGE.neustart } },
    });
  });

  it("is refused in a freeze window of the manifest", async () => {
    const id = await laufend("gesperrt", "sperre.kanzlei.test");
    const vorher = server.jetzt();
    server.stelleUhr(Date.UTC(2027, 1, 8, 9));
    try {
      expect(await ausloesen(teufel, id, "neustart", "Health rot")).toEqual({
        status: 409,
        daten: { fehler: "sperrzeit", detail: "Umsatzsteuer-Voranmeldung" },
      });
    } finally {
      server.stelleUhr(vorher);
    }
  });
});

describe("a log excerpt", () => {
  it("shows the agent's lines to both roles once they arrived (Z-1204)", async () => {
    const id = await laufend("probe", "zeilen.kanzlei.test");
    const r = await ausloesen(teufel, id, "log-auszug", "Anmeldung langsam");
    const auftragId = (r.daten.auftrag as { auftragId: string }).auftragId;
    expect(await json(teufel, logPfad(id, auftragId))).toMatchObject({
      status: 200,
      daten: { auftragId, zustand: "zugestellt", zeilen: null, zeitpunkt: null },
    });
    const zeilen = ["app[1]: started", "app[1]: token=[geheim]"];
    const meldung = { typ: "log_auszug", protokoll: 1, auftragId, zeilen } as const;
    expect(
      logAuszugAnnehmen(server.deps, { betreiberId: teufel.betreiberId, serverId }, meldung, 5),
    ).toEqual({ ok: true });
    for (const p of [teufel, inhaber2, mitglied])
      expect(await json(p, logPfad(id, auftragId))).toMatchObject({
        status: 200,
        daten: { auftragId, zeilen, zeitpunkt: 5 },
      });
  });
});

describe("no operator reaches another's", () => {
  it.each(["neustart", "log-auszug", "nur-lesen"])("%s", async (a) => {
    const id = await laufend("aktionen", `fremd-${a}.kanzlei.test`);
    const vorher = server.db.select().from(auftraege).all().length;
    expect(await ausloesen(partner, id, a, "fremd")).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
    expect(server.db.select().from(auftraege).all()).toHaveLength(vorher);
  });

  it("log excerpt", async () => {
    const id = await laufend("probe", "fremd-zeilen.kanzlei.test");
    const r = await ausloesen(teufel, id, "log-auszug", "lesen");
    const auftragId = (r.daten.auftrag as { auftragId: string }).auftragId;
    expect(await json(partner, logPfad(id, auftragId))).toEqual({
      status: 404,
      daten: { fehler: "kein_log_auszug" },
    });
  });
});

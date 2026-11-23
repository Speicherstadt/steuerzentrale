import { BACKUP_AKTIONEN, EINRICHTUNG_AKTIONEN, PFORTE_AKTIONEN } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { auftragMelden } from "../modules/auftraege/melden.ts";
import { backupAbgleichen, backupStandAnnehmen } from "../modules/backups/index.ts";
import { spalteVerschluesseln } from "../modules/geheim/spalten.ts";
import type { Server } from "../modules/server/index.ts";
import { KENNWORT, LIZENZ, signiert } from "../testhilfen/installationen.ts";
import { kundeAnlegen, serverMitAgent } from "../testhilfen/installationen-api.ts";
import { minioNachbau, TEST_ADMIN, TEST_REGION } from "../testhilfen/minio.ts";
import { SNAPSHOT } from "../testhilfen/pruef-restore.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-602 over HTTP: "Prüf-Restore jetzt" with a reason by owner and technik, for a running
 * installation whose backups are set up and have a successful run; the newest test restore in the
 * backups of the installation and on the page "Backups", and in the overview once it failed. No
 * operator reaches another's test restores (a test per endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

const minio = minioNachbau();
let server: TestServer;
let teufel: Person;
let technik: Awaited<ReturnType<TestServer["eingeladen"]>>;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
const agent: Record<string, unknown>[] = [];
let installationId = "";
let serverId = "";

const json = async (p: Pick<Person, "json">, pfad: string, init?: Parameters<Person["json"]>[1]) =>
  (await p.json(pfad, init)) as Antwort;

const melden = (
  auftragId: string,
  ergebnis: { ok: true; daten: object } | { ok: false; fehler: string },
) => {
  const s = { betreiberId: teufel.betreiberId, serverId } as Server;
  auftragMelden(server.deps, s, { typ: "bestaetigt", protokoll: 1, auftragId }, server.jetzt());
  auftragMelden(
    server.deps,
    s,
    { typ: "ergebnis", protokoll: 1, auftragId, zeit: 1, ergebnis: ergebnis as never },
    server.jetzt(),
  );
};

const auftragVon = (aktion: string) =>
  agent.filter((n) => n.aktion === aktion && n.installationId === installationId).at(-1) as
    | (Record<string, unknown> & { auftragId: string })
    | undefined;

const pfad = () => `/api/v1/installationen/${installationId}`;
const jetzt = (p: Pick<Person, "json">, grund = "nach dem Umzug des Buckets") =>
  json(p, `${pfad()}/pruef-restore`, { body: { grund } });

beforeAll(async () => {
  server = testServer(afterAll);
  afterAll(() => minio.stoppen());
  teufel = await server.inhaber();
  technik = await server.eingeladen(teufel, "technik");
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  const kontext = { betreiberId: teufel.betreiberId, akteur: "t", jetzt: 1, grund: "t" };
  schreiben(server.schreibDb, kontext, "test", (w) =>
    w.einfuegen("appEinstellungen", {
      betreiberId: teufel.betreiberId,
      app: "probe",
      name: "PROBE_LIZENZ",
      wert: null,
      wertVerschluesselt: spalteVerschluesseln(
        server.schluessel,
        "appEinstellungen",
        teufel.betreiberId,
        { app: "probe", name: "PROBE_LIZENZ" },
        JSON.stringify(LIZENZ),
      ),
      geaendertAm: 1,
    }),
  );
  await json(teufel, "/api/v1/backup-ziel", {
    method: "PUT",
    body: {
      endpunkt: minio.url,
      region: TEST_REGION,
      bucket: "backups",
      ...TEST_ADMIN,
      grund: "t",
    },
  });
  const kundeId = await kundeAnlegen(json, teufel, "Kanzlei Süd");
  serverId = await serverMitAgent(server, json, teufel, agent);
  const angelegt = await json(teufel, "/api/v1/installationen", {
    body: {
      kundeId,
      serverId,
      ...signiert("gesichert"),
      host: "probe.kanzlei-sued.example",
      einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
      grund: "Bestellung",
    },
  });
  installationId = String(angelegt.daten.installationId);
  melden(auftragVon(EINRICHTUNG_AKTIONEN.einrichten)?.auftragId ?? "", { ok: true, daten: {} });
  melden(auftragVon(PFORTE_AKTIONEN.setzen)?.auftragId ?? "", { ok: true, daten: {} });
  await backupAbgleichen({ ...server.deps, fetch });
  melden(auftragVon(BACKUP_AKTIONEN.einrichten)?.auftragId ?? "", { ok: true, daten: {} });
}, 60_000);

describe("Prüf-Restore jetzt", () => {
  it("needs a successful backup run first", async () => {
    expect(await jetzt(technik)).toEqual({ status: 409, daten: { fehler: "kein_backup" } });
    backupStandAnnehmen(
      server.deps,
      { betreiberId: teufel.betreiberId, serverId } as Server,
      {
        typ: "backup_stand",
        protokoll: 1,
        installationId,
        lauf: "lauf-1",
        beginn: server.jetzt() - 60_000,
        ende: server.jetzt(),
        ok: true,
        teile: [{ tag: "volume:daten", ok: true, snapshot: SNAPSHOT }],
      },
      server.jetzt(),
    );
  });

  it("is refused to support and without a reason", async () => {
    expect(await jetzt(support)).toEqual({ status: 403, daten: { fehler: "keine_berechtigung" } });
    expect((await jetzt(technik, " ")).status).toBe(400);
  });

  it("makes the job with a reason, by technik, and only one at a time", async () => {
    const r = await jetzt(technik);
    expect(r).toMatchObject({
      status: 201,
      daten: { auftrag: { aktion: "installation_pruef_restore", zustand: "zugestellt" } },
    });
    const job = auftragVon("installation_pruef_restore");
    expect(job?.argumente).toEqual({ kopie: expect.stringMatching(/^restore-[a-z0-9]{6}$/) });
    expect(job && "backup" in job).toBe(false);
    expect((await json(support, `${pfad()}/backups`)).daten.pruefRestore).toEqual({
      letzter: null,
      laeuft: true,
    });
    expect(await jetzt(teufel)).toEqual({ status: 409, daten: { fehler: "auftrag_offen" } });
    const audit = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "installation.pruef-restore");
    // the job and the copy's ports, each with who and why
    expect(audit.map((e) => e.ziel.split(":")[0]).sort()).toEqual([
      "auftraege",
      "installationsPorts",
      "installationsPorts",
    ]);
    for (const e of audit)
      expect(e).toMatchObject({ akteur: technik.nutzerId, grund: "nach dem Umzug des Buckets" });
  });

  it("shows the newest test restore, and a failed one in the overview", async () => {
    melden(auftragVon("installation_pruef_restore")?.auftragId ?? "", {
      ok: false,
      fehler: "Health der Kopie blieb rot",
    });
    const letzter = {
      zeitpunkt: server.jetzt(),
      ok: false,
      grund: "Health der Kopie blieb rot",
      kopie: (auftragVon("installation_pruef_restore")?.argumente as { kopie?: string })?.kopie,
      teile: [],
      dauerMs: null,
    };
    expect((await json(support, `${pfad()}/backups`)).daten.pruefRestore).toEqual({
      letzter,
      laeuft: false,
    });
    const { daten } = await json(support, "/api/v1/backups");
    expect(daten.installationen).toEqual([
      expect.objectContaining({ installationId, pruefRestore: { letzter, laeuft: false } }),
    ]);
    const uebersicht = await json(support, "/api/v1/uebersicht");
    const eintraege = uebersicht.daten.eintraege as { art: string }[];
    expect(eintraege.filter((e) => e.art === "pruef_restore")).toEqual([
      expect.objectContaining({
        schwere: "warnung",
        gescheitert: true,
        grund: "Health der Kopie blieb rot",
        installation: expect.objectContaining({ installationId, kunde: "Kanzlei Süd" }),
        verweis: { art: "installation", id: installationId },
      }),
    ]);
    // neither the failed job nor its event stands beside it
    expect(eintraege.filter((e) => e.art === "auftrag" || e.art === "ereignis")).toEqual([]);
  });
});

describe("no operator reaches another's test restores", () => {
  it("POST /api/v1/installationen/:installationId/pruef-restore knows one's own only", async () => {
    const vorher = agent.length;
    expect(await jetzt(partner, "fremd")).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
    expect(agent.length).toBe(vorher);
  });

  it("GET /api/v1/installationen/:installationId/backups knows one's own only", async () => {
    expect((await json(partner, `${pfad()}/backups`)).status).toBe(404);
  });

  it("GET /api/v1/backups and GET /api/v1/uebersicht show one's own only", async () => {
    expect((await json(partner, "/api/v1/backups")).daten).toEqual({ installationen: [] });
    const { daten } = await json(partner, "/api/v1/uebersicht");
    expect(JSON.stringify(daten)).not.toContain(installationId);
  });
});

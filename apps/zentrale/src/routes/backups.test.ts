import { BACKUP_AKTIONEN, EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, backupZiele, geheimnisse } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { auftragMelden } from "../modules/auftraege/melden.ts";
import { backupAbgleichen, backupStandAnnehmen } from "../modules/backups/index.ts";
import { spalteVerschluesseln } from "../modules/geheim/spalten.ts";
import type { Server } from "../modules/server/index.ts";
import { dateiInhalt, KENNWORT, LIZENZ } from "../testhilfen/installationen.ts";
import {
  kundeAnlegen,
  manifestHochladen,
  serverMitAgent,
} from "../testhilfen/installationen-api.ts";
import { minioNachbau, TEST_ADMIN, TEST_REGION } from "../testhilfen/minio.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-601 over HTTP: the operator's S3 target, set with a reason by owner and inhaber2 and
 * read by every role, its admin access only as `zugangGesetzt`; the backups of an installation and
 * the overview of the page "Backups"; "Backup jetzt" with a reason by owner and inhaber2, once the
 * backups of a running installation are set up. No answer carries an access or a password, and no
 * operator reaches another's backups or S3 target (a test per endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

const minio = minioNachbau();
const SNAPSHOT = "4f2a9c1e".repeat(8);
let server: TestServer;
let teufel: Person;
let inhaber2: Awaited<ReturnType<TestServer["eingeladen"]>>;
let mitglied: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
const agent: Record<string, unknown>[] = [];
const antworten: unknown[] = [];
let installationId = "";
let serverId = "";

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
) => {
  const a = (await p.json(pfad, init)) as Antwort;
  antworten.push(a.daten);
  return a;
};

const ziel = (teil: Record<string, unknown> = {}) => ({
  endpunkt: minio.url,
  region: TEST_REGION,
  bucket: "backups",
  ...TEST_ADMIN,
  grund: "MinIO beim Betreiber eingerichtet",
  ...teil,
});

/** The agent of the installation's server reports the job done */
const erledigt = (auftragId: string) => {
  const s = { betreiberId: teufel.betreiberId, serverId } as Server;
  auftragMelden(server.deps, s, { typ: "bestaetigt", protokoll: 1, auftragId }, server.jetzt());
  auftragMelden(
    server.deps,
    s,
    { typ: "ergebnis", protokoll: 1, auftragId, zeit: 1, ergebnis: { ok: true, daten: {} } },
    server.jetzt(),
  );
};

const auftragVon = (aktion: string) =>
  agent.filter((n) => n.aktion === aktion && n.installationId === installationId).at(-1) as
    | (Record<string, unknown> & { auftragId: string })
    | undefined;

const backupPfad = () => `/api/v1/installationen/${installationId}`;

beforeAll(async () => {
  server = testServer(afterAll);
  afterAll(() => minio.stoppen());
  teufel = await server.inhaber();
  inhaber2 = await server.eingeladen(teufel, "inhaber");
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
}, 60_000);

describe("the S3 target", () => {
  it("starts empty and is not set without an admin access", async () => {
    expect(await json(mitglied, "/api/v1/backup-ziel")).toEqual({
      status: 200,
      daten: { endpunkt: null, region: null, bucket: null, zugangGesetzt: false },
    });
    const { accessKey: _a, secretKey: _s, ...ohne } = ziel();
    expect(await json(teufel, "/api/v1/backup-ziel", { method: "PUT", body: ohne })).toEqual({
      status: 422,
      daten: { fehler: "zugang_fehlt" },
    });
  });

  it("is set with a reason; the admin access comes back only as set and is kept when left out", async () => {
    const gesetzt = await json(teufel, "/api/v1/backup-ziel", { method: "PUT", body: ziel() });
    expect(gesetzt).toEqual({
      status: 200,
      daten: { endpunkt: minio.url, region: TEST_REGION, bucket: "backups", zugangGesetzt: true },
    });
    const { accessKey: _a, secretKey: _s, ...ohne } = ziel({ grund: "Region geprüft" });
    expect(
      (await json(inhaber2, "/api/v1/backup-ziel", { method: "PUT", body: ohne })).daten,
    ).toEqual(gesetzt.daten);
    expect((await json(mitglied, "/api/v1/backup-ziel")).daten).toEqual(gesetzt.daten);
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "backup.ziel");
    expect(eintraege.map((e) => [e.akteur, e.ziel])).toEqual([
      [teufel.nutzerId, "backupZiele"],
      [teufel.nutzerId, "geheimnisse:backup-s3-admin"],
    ]);
    expect(eintraege[1]?.inhalt).toContain("[verschlüsselt]");
  });

  it("refuses mitglied, an invalid field and a missing reason", async () => {
    expect(await json(mitglied, "/api/v1/backup-ziel", { method: "PUT", body: ziel() })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    for (const falsch of [
      { endpunkt: "http://s3.example.de" },
      { endpunkt: "https://s3.example.de/pfad" },
      { endpunkt: "https://nutzer:pw@s3.example.de" },
      { endpunkt: "ftp://s3.example.de" },
      { bucket: "Backups" },
      { region: "EU Central" },
      { secretKey: undefined },
      { accessKey: "mit leerzeichen" },
      { grund: " " },
      { unbekannt: 1 },
    ])
      expect(
        (await json(teufel, "/api/v1/backup-ziel", { method: "PUT", body: ziel(falsch) })).status,
        JSON.stringify(falsch),
      ).toBe(400);
  });
});

describe("the backups of an installation", () => {
  it("are set up after its setup, and their job carries what the agent needs", async () => {
    schreiben(
      server.schreibDb,
      { betreiberId: teufel.betreiberId, akteur: "t", jetzt: 1, grund: "t" },
      "test",
      (w) =>
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
    const kundeId = await kundeAnlegen(json, teufel, "Kanzlei Süd");
    serverId = await serverMitAgent(server, json, teufel, agent);
    const angelegt = await json(teufel, "/api/v1/installationen", {
      body: {
        kundeId,
        serverId,
        ...(await manifestHochladen(json, teufel, "gesichert")),
        host: "probe.kanzlei-sued.example",
        einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
        grund: "Bestellung",
      },
    });
    expect(angelegt.status).toBe(201);
    installationId = String(angelegt.daten.installationId);
    expect(await json(mitglied, `${backupPfad()}/backups`)).toEqual({
      status: 200,
      daten: {
        installationId,
        teile: [
          { art: "volume", name: "daten" },
          { art: "befehl", name: "sichern" },
        ],
        zugang: null,
        eingerichtet: false,
        laeufe: [],
        pruefRestore: { letzter: null, laeuft: false },
        wiederherstellen: { letzter: null, laeuft: false },
      },
    });
    erledigt(auftragVon(EINRICHTUNG_AKTIONEN.einrichten)?.auftragId ?? "");
    await backupAbgleichen({ ...server.deps, fetch });
    expect(minio.konten().map((k) => k.name)).toEqual([`sz-${installationId}`]);
    const job = auftragVon(BACKUP_AKTIONEN.einrichten);
    expect(job?.backup).toMatchObject({
      repository: `s3:${minio.url}/backups/${teufel.betreiberId}/${installationId}`,
    });
    expect((await json(mitglied, `${backupPfad()}/backups`)).daten).toMatchObject({
      zugang: "angelegt",
      eingerichtet: false,
    });
  });

  it("are run now only once set up, with a reason, by owner and inhaber2", async () => {
    const jetzt = (p: Pick<Person, "json">, grund = "vor dem Update") =>
      json(p, `${backupPfad()}/backup`, { body: { grund } });
    expect(await jetzt(inhaber2)).toEqual({ status: 409, daten: { fehler: "nicht_eingerichtet" } });
    erledigt(auftragVon(BACKUP_AKTIONEN.einrichten)?.auftragId ?? "");
    expect((await json(mitglied, `${backupPfad()}/backups`)).daten.eingerichtet).toBe(true);
    expect((await jetzt(mitglied)).status).toBe(403);
    expect((await jetzt(inhaber2, " ")).status).toBe(400);
    const r = await jetzt(inhaber2);
    expect(r).toMatchObject({
      status: 201,
      daten: { auftrag: { aktion: BACKUP_AKTIONEN.jetzt, zustand: "zugestellt" } },
    });
    const job = auftragVon(BACKUP_AKTIONEN.jetzt);
    expect(job).toMatchObject({ argumente: {}, installationId });
    expect(job && "backup" in job).toBe(false);
    expect(await jetzt(teufel)).toEqual({ status: 409, daten: { fehler: "backup_laeuft" } });
    const audit = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "installation.backup");
    expect(audit).toEqual([
      expect.objectContaining({ akteur: inhaber2.nutzerId, grund: "vor dem Update" }),
    ]);
  });

  it("show the runs the agent reported, here and on the page Backups", async () => {
    const s = { betreiberId: teufel.betreiberId, serverId, name: "Server A" } as Server;
    const lauf = (ende: number, ok: boolean) => ({
      typ: "backup_stand" as const,
      protokoll: 1,
      installationId,
      lauf: crypto.randomUUID(),
      beginn: ende - 60_000,
      ende,
      ok,
      teile: [
        { tag: "volume:daten", ok: true, snapshot: SNAPSHOT },
        ok
          ? { tag: "befehl:sichern", ok: true, snapshot: SNAPSHOT }
          : { tag: "befehl:sichern", ok: false, fehler: "die Quelle endete mit Code 1" },
      ],
      ...(ok ? {} : { fehler: "befehl:sichern: die Quelle endete mit Code 1" }),
    });
    backupStandAnnehmen(server.deps, s, lauf(server.jetzt() - 7_200_000, true), server.jetzt());
    backupStandAnnehmen(server.deps, s, lauf(server.jetzt() - 3_600_000, false), server.jetzt());
    const seite = await json(mitglied, `${backupPfad()}/backups`);
    expect(seite.daten.laeufe).toEqual([
      {
        id: expect.stringMatching(/^backup-[0-9a-f]{32}$/),
        zeitpunkt: server.jetzt() - 3_600_000,
        ok: false,
        grund: "befehl:sichern: die Quelle endete mit Code 1",
        teile: lauf(0, false).teile,
      },
      {
        id: expect.stringMatching(/^backup-[0-9a-f]{32}$/),
        zeitpunkt: server.jetzt() - 7_200_000,
        ok: true,
        grund: null,
        teile: lauf(0, true).teile,
      },
    ]);
    const { daten } = await json(mitglied, "/api/v1/backups");
    expect(daten.installationen).toEqual([
      expect.objectContaining({
        installationId,
        app: "probe",
        kundeName: "Kanzlei Süd",
        serverName: "Server A",
        zugang: "angelegt",
        eingerichtet: true,
        letzter: expect.objectContaining({ ok: false, grund: expect.stringContaining("Code 1") }),
        letzterErfolg: server.jetzt() - 7_200_000,
      }),
    ]);
  });

  it("never put an access or a password into an answer, the log or the database file", () => {
    const job = auftragVon(BACKUP_AKTIONEN.einrichten) as unknown as {
      backup: { zugang: { geheim: string }; passwort: string };
    };
    for (const geheim of [TEST_ADMIN.secretKey, job.backup.zugang.geheim, job.backup.passwort]) {
      expect(JSON.stringify(antworten)).not.toContain(geheim);
      expect(server.log.join("\n")).not.toContain(geheim);
      expect(dateiInhalt(server.pfad)).not.toContain(geheim);
    }
  });
});

describe("no operator reaches another's backups or S3 target", () => {
  it("GET /api/v1/backups shows one's own only", async () => {
    expect((await json(partner, "/api/v1/backups")).daten).toEqual({ installationen: [] });
  });

  it("GET /api/v1/installationen/:installationId/backups knows one's own only", async () => {
    expect(await json(partner, `${backupPfad()}/backups`)).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
  });

  it("POST /api/v1/installationen/:installationId/backup knows one's own only", async () => {
    const vorher = agent.length;
    expect(await json(partner, `${backupPfad()}/backup`, { body: { grund: "fremd" } })).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
    expect(agent.length).toBe(vorher);
  });

  it("GET /api/v1/backup-ziel shows one's own only", async () => {
    expect((await json(partner, "/api/v1/backup-ziel")).daten).toEqual({
      endpunkt: null,
      region: null,
      bucket: null,
      zugangGesetzt: false,
    });
  });

  it("PUT /api/v1/backup-ziel sets one's own only", async () => {
    const eigen = () =>
      [
        server.db
          .select()
          .from(backupZiele)
          .all()
          .find((z) => z.betreiberId === teufel.betreiberId),
        server.db
          .select()
          .from(geheimnisse)
          .all()
          .find((g) => g.betreiberId === teufel.betreiberId && g.geheimnisId === "backup-s3-admin")
          ?.wert,
      ] as const;
    const vorher = eigen();
    const a = await json(partner, "/api/v1/backup-ziel", {
      method: "PUT",
      body: ziel({ bucket: "partner", accessKey: "partner-admin", secretKey: "partner-geheim-1" }),
    });
    expect(a.daten).toEqual({
      endpunkt: minio.url,
      region: TEST_REGION,
      bucket: "partner",
      zugangGesetzt: true,
    });
    expect(eigen()).toEqual(vorher);
    // with an access made there, endpoint and bucket stay as they are
    expect(
      await json(teufel, "/api/v1/backup-ziel", { method: "PUT", body: ziel({ bucket: "neu" }) }),
    ).toEqual({ status: 409, daten: { fehler: "ziel_in_benutzung" } });
  });
});

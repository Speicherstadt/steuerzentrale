import {
  BACKUP_AKTIONEN,
  EINRICHTUNG_AKTIONEN,
  PFORTE_AKTIONEN,
  snapshotArgument,
  WIEDERHERSTELLEN_AKTION,
} from "@steuerzentrale/manifest";
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
 * BAULISTE.md Z-603 over HTTP: restoring a successful run with a reason, by owner and technik, for a
 * running installation whose backups are set up and that has no open job; the backup of the current
 * state goes first, the restore waits for it; the restore's state in the installation's backups.
 * No operator reaches another's restores (a test per endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };
type Lauf = { id: string; ok: boolean };

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

/** A run as the agent reports it */
const lauf = (name: string, ok: boolean) =>
  backupStandAnnehmen(
    server.deps,
    { betreiberId: teufel.betreiberId, serverId } as Server,
    {
      typ: "backup_stand",
      protokoll: 1,
      installationId,
      lauf: name,
      beginn: server.jetzt() - 60_000,
      ende: server.jetzt(),
      ok,
      teile: [{ tag: "volume:daten", ok, ...(ok ? { snapshot: SNAPSHOT } : {}) }],
    },
    server.jetzt(),
  );

const pfad = () => `/api/v1/installationen/${installationId}`;
const backups = async () => (await json(support, `${pfad()}/backups`)).daten;
const laeufe = async () => (await backups()).laeufe as Lauf[];
const wiederherstellen = (p: Pick<Person, "json">, body: Record<string, unknown>) =>
  json(p, `${pfad()}/wiederherstellen`, { body });

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
  lauf("lauf-gut", true);
  lauf("lauf-kaputt", false);
}, 60_000);

describe("restoring a run", () => {
  it("names each run by its id, and no restore yet", async () => {
    const l = await laeufe();
    expect(l).toHaveLength(2);
    for (const x of l) expect(x.id).toMatch(/^backup-[0-9a-f]{32}$/);
    expect((await backups()).wiederherstellen).toEqual({ letzter: null, laeuft: false });
  });

  it("is refused to support, without a reason and without a run", async () => {
    const gut = (await laeufe()).find((x) => x.ok)?.id;
    expect(await wiederherstellen(support, { lauf: gut, grund: "x" })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    expect((await wiederherstellen(technik, { lauf: gut, grund: " " })).status).toBe(400);
    expect((await wiederherstellen(technik, { grund: "x" })).status).toBe(400);
  });

  it("refuses a failed run and one it does not know", async () => {
    const kaputt = (await laeufe()).find((x) => !x.ok)?.id;
    expect(await wiederherstellen(technik, { lauf: kaputt, grund: "x" })).toEqual({
      status: 422,
      daten: { fehler: "lauf_gescheitert" },
    });
    expect(await wiederherstellen(technik, { lauf: "backup-fremd", grund: "x" })).toEqual({
      status: 422,
      daten: { fehler: "lauf_unbekannt" },
    });
  });

  it("backs up first and restores after it, by technik, with the reason in the audit log", async () => {
    const gut = (await laeufe()).find((x) => x.ok)?.id;
    const r = await wiederherstellen(technik, { lauf: gut, grund: "Auftrag des Kunden" });
    expect(r).toMatchObject({
      status: 201,
      daten: {
        backup: { aktion: BACKUP_AKTIONEN.jetzt, zustand: "zugestellt" },
        wiederherstellen: { aktion: WIEDERHERSTELLEN_AKTION, zustand: "wartend" },
      },
    });
    expect(auftragVon(WIEDERHERSTELLEN_AKTION)).toBeUndefined();
    expect((await backups()).wiederherstellen).toMatchObject({
      laeuft: true,
      letzter: { phase: "sichern" },
    });
    expect(await wiederherstellen(teufel, { lauf: gut, grund: "noch einmal" })).toEqual({
      status: 409,
      daten: { fehler: "auftrag_offen" },
    });
    const audit = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "installation.wiederherstellen");
    expect(audit.map((e) => e.ziel.split(":")[0])).toEqual([
      "auftraege",
      "auftraege",
      "wiederherstellungen",
    ]);
    for (const e of audit)
      expect(e).toMatchObject({ akteur: technik.nutzerId, grund: "Auftrag des Kunden" });
  });

  it("shows the restore under way, then done, and its event", async () => {
    melden(auftragVon(BACKUP_AKTIONEN.jetzt)?.auftragId ?? "", { ok: true, daten: {} });
    const job = auftragVon(WIEDERHERSTELLEN_AKTION);
    expect(job?.argumente).toEqual({ [snapshotArgument("volume:daten")]: SNAPSHOT });
    expect((await backups()).wiederherstellen).toMatchObject({
      letzter: { phase: "zurueckspielen" },
    });
    const teile = [{ tag: "volume:daten", snapshot: SNAPSHOT, zurueckgespielt: true }];
    melden(job?.auftragId ?? "", { ok: true, daten: { teile, dauerMs: 61_000 } });
    expect((await backups()).wiederherstellen).toMatchObject({
      laeuft: false,
      letzter: { phase: "gelungen", teile: [{ ...teile[0], grund: null }], dauerMs: 61_000 },
    });
    const ziel = `installation:${installationId}`;
    const { daten } = await json(support, `/api/v1/ereignisse?ziel=${encodeURIComponent(ziel)}`);
    expect(daten.eintraege).toEqual(
      expect.arrayContaining([expect.objectContaining({ art: "wiederherstellen_gelungen" })]),
    );
  });

  it("is open to the owner once nothing is open", async () => {
    const gut = (await laeufe()).find((x) => x.ok)?.id;
    expect((await wiederherstellen(teufel, { lauf: gut, grund: "zweiter Versuch" })).status).toBe(
      201,
    );
  });

  it("writes an event for a failed restore, which stands for its job in the overview", async () => {
    melden(auftragVon(BACKUP_AKTIONEN.jetzt)?.auftragId ?? "", { ok: true, daten: {} });
    melden(auftragVon(WIEDERHERSTELLEN_AKTION)?.auftragId ?? "", {
      ok: false,
      fehler: "Wiederherstellen gescheitert: Health blieb rot",
    });
    expect((await backups()).wiederherstellen).toMatchObject({
      laeuft: false,
      letzter: { phase: "gescheitert", fehler: "Wiederherstellen gescheitert: Health blieb rot" },
    });
    const ereignisse = await json(teufel, "/api/v1/ereignisse?art=wiederherstellen_gescheitert");
    expect(ereignisse.daten.eintraege).toEqual([
      expect.objectContaining({ schwere: "fehler", ziel: `installation:${installationId}` }),
    ]);
    // the overview leaves the failed job out: its event stands for it
    const { daten } = await json(teufel, "/api/v1/uebersicht");
    const eintraege = daten.eintraege as { aktion?: string }[];
    expect(eintraege.filter((e) => e.aktion === WIEDERHERSTELLEN_AKTION)).toEqual([]);
  });
});

describe("no operator reaches another's restores", () => {
  it("POST /api/v1/installationen/:installationId/wiederherstellen knows one's own only", async () => {
    const vorher = agent.length;
    const gut = (await laeufe()).find((x) => x.ok)?.id;
    expect(await wiederherstellen(partner, { lauf: gut, grund: "fremd" })).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
    expect(agent.length).toBe(vorher);
  });

  it("GET /api/v1/installationen/:installationId/backups knows one's own only", async () => {
    expect((await json(partner, `${pfad()}/backups`)).status).toBe(404);
  });

  it("GET /api/v1/backups and GET /api/v1/ereignisse show one's own only", async () => {
    expect((await json(partner, "/api/v1/backups")).daten).toEqual({ installationen: [] });
    const { daten } = await json(partner, "/api/v1/ereignisse");
    expect(JSON.stringify(daten)).not.toContain(installationId);
  });
});

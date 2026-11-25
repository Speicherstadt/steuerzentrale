import {
  BACKUP_AKTIONEN,
  EINRICHTUNG_AKTIONEN,
  PFORTE_AKTIONEN,
  snapshotArgument,
  UPDATE_AKTION,
} from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { auftragMelden } from "../modules/auftraege/melden.ts";
import { backupAbgleichen } from "../modules/backups/index.ts";
import { spalteVerschluesseln } from "../modules/geheim/spalten.ts";
import type { Server } from "../modules/server/index.ts";
import { KENNWORT, LIZENZ } from "../testhilfen/installationen.ts";
import {
  kundeAnlegen,
  manifestHochladen,
  serverMitAgent,
} from "../testhilfen/installationen-api.ts";
import { minioNachbau, TEST_ADMIN, TEST_REGION } from "../testhilfen/minio.ts";
import { SNAPSHOT } from "../testhilfen/pruef-restore.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";
import { backupDaten } from "../testhilfen/updates.ts";

/*
 * BAULISTE.md Z-503 over HTTP: an update by hand with a version and a reason, by owner and inhaber2;
 * in a freeze window of the app only the owner; the backup of the current state goes first, the
 * update waits for it; offers, plan and the last update of each installation on the page
 * "Updates". No operator reaches another's installations or updates (a test per endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };
type Zeile = {
  installationId: string;
  version: string;
  plan: Record<string, unknown> | null;
  update: { letzter: Record<string, unknown> | null; laeuft: boolean };
};

const minio = minioNachbau();
let server: TestServer;
let teufel: Person;
let inhaber2: Awaited<ReturnType<TestServer["eingeladen"]>>;
let mitglied: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
const agent: Record<string, unknown>[] = [];
let installationId = "";
let serverId = "";

// The app's freeze window is the 7th to the 12th of every month (gesichert-gesperrt.yml)
const IN_SPERRZEIT = Date.UTC(2027, 1, 8, 10, 0);
const DANACH = Date.UTC(2027, 1, 15, 10, 0);

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

const update = (p: Pick<Person, "json">, body: Record<string, unknown>) =>
  json(p, `/api/v1/installationen/${installationId}/update`, { body });

const zeile = async (p: Pick<Person, "json"> = mitglied) =>
  ((await json(p, "/api/v1/updates")).daten.installationen as Zeile[]).find(
    (i) => i.installationId === installationId,
  );

/** The backup before the update succeeds, then the agent reports the update's end */
const durchlaufen = (daten: Record<string, unknown>) => {
  melden(auftragVon(BACKUP_AKTIONEN.jetzt)?.auftragId ?? "", { ok: true, daten: backupDaten() });
  melden(auftragVon(UPDATE_AKTION)?.auftragId ?? "", { ok: true, daten });
};

beforeAll(async () => {
  server = testServer(afterAll);
  afterAll(() => minio.stoppen());
  teufel = await server.inhaber();
  inhaber2 = await server.eingeladen(teufel, "inhaber");
  mitglied = await server.eingeladen(teufel, "mitglied");
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
      ...(await manifestHochladen(json, teufel, "gesichert-gesperrt")),
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
  await manifestHochladen(json, teufel, "update-1.3.0");
}, 60_000);

describe("an update by hand", () => {
  it("is refused to mitglied, without a reason or a version", async () => {
    expect(await update(mitglied, { version: "1.3.0", grund: "x" })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    expect((await update(inhaber2, { version: "1.3.0", grund: " " })).status).toBe(400);
    expect((await update(inhaber2, { grund: "x" })).status).toBe(400);
    expect(await update(inhaber2, { version: "1.0.4", grund: "x" })).toEqual({
      status: 422,
      daten: { fehler: "nicht_angeboten" },
    });
  });

  it("is in a freeze window the owner's only, who passes over it; a member updates never", async () => {
    server.uhr.ms = IN_SPERRZEIT;
    expect(await update(mitglied, { version: "1.3.0", grund: "x" })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    const r = await update(teufel, {
      version: "1.3.0",
      grund: "Sicherheitslücke, Kunde weiß Bescheid",
    });
    expect(r.status).toBe(201);
    expect((await zeile())?.update).toMatchObject({
      laeuft: true,
      letzter: {
        nachVersion: "1.3.0",
        anlass: "hand",
        sperrzeitUebergangen: true,
        phase: "sichern",
      },
    });
  });

  it("shows a rollback with its reason and keeps the old version", async () => {
    durchlaufen({ ergebnis: "zurueckgenommen", grund: "Health blieb rot", dauerMs: 300_000 });
    const z = await zeile();
    expect(z?.version).toBe("1.0.4");
    expect(z?.update).toMatchObject({
      laeuft: false,
      letzter: { phase: "zurueckgenommen", fehler: "Health blieb rot", dauerMs: 300_000 },
    });
    // the version is halted: the plan updates no further installation to it
    expect(z?.plan).toMatchObject({
      version: "1.3.0",
      welle: "alle",
      art: "wartet",
      grund: "angehalten",
    });
    const ereignisse = await json(mitglied, "/api/v1/ereignisse?art=update_zurueckgenommen");
    expect(ereignisse.daten.eintraege).toEqual([
      expect.objectContaining({ schwere: "fehler", ziel: `installation:${installationId}` }),
    ]);
  });

  it("backs up first and updates after it, by inhaber2, with the reason in the audit log", async () => {
    server.uhr.ms = DANACH;
    const r = await update(inhaber2, { version: "1.3.0", grund: "Wunsch des Kunden" });
    expect(r).toMatchObject({
      status: 201,
      daten: {
        backup: { aktion: BACKUP_AKTIONEN.jetzt, zustand: "zugestellt" },
        update: { aktion: UPDATE_AKTION, zustand: "wartend" },
      },
    });
    expect(await update(teufel, { version: "1.3.0", grund: "noch einmal" })).toEqual({
      status: 409,
      daten: { fehler: "auftrag_offen" },
    });
    const audit = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "installation.update" && e.grund === "Wunsch des Kunden");
    expect(audit.map((e) => e.ziel.split(":")[0])).toEqual([
      "auftraege",
      "auftraege",
      "installationKonfigurationen",
      "updates",
    ]);
    for (const e of audit) expect(e.akteur).toBe(inhaber2.nutzerId);
  });

  it("sends the update with the backup's snapshots and raises the version once it holds", async () => {
    durchlaufen({ ergebnis: "aktualisiert", dauerMs: 41_000 });
    expect(auftragVon(UPDATE_AKTION)?.argumente).toEqual({
      [snapshotArgument("volume:daten")]: SNAPSHOT,
    });
    const z = await zeile();
    expect(z?.version).toBe("1.3.0");
    expect(z?.plan).toBeNull();
    expect(z?.update).toMatchObject({
      laeuft: false,
      letzter: {
        vonVersion: "1.0.4",
        nachVersion: "1.3.0",
        phase: "aktualisiert",
        dauerMs: 41_000,
      },
    });
    const i = await json(mitglied, `/api/v1/installationen/${installationId}`);
    expect(i.daten).toMatchObject({ version: "1.3.0" });
  });
});

describe("no operator reaches another's updates", () => {
  it("POST /api/v1/installationen/:installationId/update knows one's own only", async () => {
    const vorher = agent.length;
    expect(await update(partner, { version: "1.3.0", grund: "fremd" })).toEqual({
      status: 404,
      daten: { fehler: "keine_installation" },
    });
    expect(agent.length).toBe(vorher);
  });

  it("GET /api/v1/updates shows one's own installations and updates only", async () => {
    const { daten } = await json(partner, "/api/v1/updates");
    expect(daten).toEqual({ installationen: [] });
  });
});

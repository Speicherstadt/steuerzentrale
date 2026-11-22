import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appEinstellungen, auditLog, auftraege, installationen } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { dateiInhalt, KENNWORT, LIZENZ, signiert } from "../testhilfen/installationen.ts";
import { kundeAnlegen, serverMitAgent } from "../testhilfen/installationen-api.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-404 over HTTP: the operator's values of an app (read, written, and added in the
 * dialog "App installieren" in the installation's transaction) and "Einstellungen ändern" of an
 * installation. Every role reads, owner and technik write with a reason; no operator reaches
 * another's settings (a test per endpoint); no answer, audit entry or database byte holds a secret.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

const NEUE_LIZENZ = "neue-lizenz-ueber-die-api-0c4f7e";
const NEUES_KENNWORT = "neues-kennwort-ueber-die-api-8e21d3";
const PARTNER_LIZENZ = "lizenz-des-partners-aus-dem-dialog-77ab90";

let server: TestServer;
let teufel: Person;
let technik: Awaited<ReturnType<TestServer["eingeladen"]>>;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
let kundeId: string;
let serverId: string;
let laufend: string;
const antworten: unknown[] = [];

const json = async (
  p: Pick<Person, "json">,
  pfad: string,
  init?: Parameters<Person["json"]>[1],
) => {
  const a = (await p.json(pfad, init)) as Antwort;
  antworten.push(a.daten);
  return a;
};

const neu = (host: string, teil: Record<string, unknown> = {}) => ({
  kundeId,
  serverId,
  ...signiert("probe"),
  optionen: [],
  host,
  einstellungen: { PROBE_TITEL: "Kanzlei", PROBE_KENNWORT: KENNWORT },
  grund: "Auftrag",
  ...teil,
});

/** The installation running, its setup and route done, as the agent would have reported */
const eingerichtet = (betreiberId: string, installationId: string) =>
  schreiben(
    server.schreibDb,
    { betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
    "test",
    (w) => {
      w.aendern("installationen", { installationId }, { zustand: "laeuft" });
      for (const a of server.db.select().from(auftraege).all())
        if (a.installationId === installationId)
          w.aendern("auftraege", { auftragId: a.auftragId }, { zustand: "erfolgreich" });
    },
  );

const APP = "/api/v1/apps/probe/einstellungen";
const einstellungen = (id: string) => `/api/v1/installationen/${id}/einstellungen`;

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  technik = await server.eingeladen(teufel, "technik");
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  kundeId = await kundeAnlegen(json, teufel);
  serverId = await serverMitAgent(server, json, teufel, []);
}, 60_000);

describe("the operator's values of an app", () => {
  it("have no form before the operator has an installation of the app", async () => {
    expect(await json(support, APP)).toEqual({ status: 404, daten: { fehler: "kein_manifest" } });
    expect(
      await json(teufel, APP, { method: "PUT", body: { werte: {}, grund: "erste Werte" } }),
    ).toEqual({ status: 404, daten: { fehler: "kein_manifest" } });
  });

  it("are added in the dialog, in the installation's transaction, and block it while missing", async () => {
    const ohne = await json(teufel, "/api/v1/installationen", { body: neu("ohne.kanzlei.test") });
    expect(ohne).toMatchObject({
      status: 409,
      daten: {
        fehler: "passt_nicht",
        gruende: [{ code: "betreiberwert_fehlt", werte: { name: "PROBE_LIZENZ" } }],
      },
    });
    const falsch = await json(teufel, "/api/v1/installationen", {
      body: neu("falsch.kanzlei.test", { betreiberWerte: { PROBE_LIZENZ: 5 } }),
    });
    expect(falsch).toEqual({
      status: 400,
      daten: { fehler: "einstellung_ungueltig", detail: "PROBE_LIZENZ: a value of another type" },
    });
    expect(server.db.select().from(appEinstellungen).all()).toEqual([]);
    const mit = await json(technik, "/api/v1/installationen", {
      body: neu("mit.kanzlei.test", { betreiberWerte: { PROBE_LIZENZ: LIZENZ } }),
    });
    expect(mit.status).toBe(201);
    laufend = String(mit.daten.installationId);
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "installation.anlegen");
    expect(eintraege.map((e) => e.ziel)).toContain("appEinstellungen:probe:PROBE_LIZENZ");
    expect(new Set(eintraege.map((e) => e.zeitpunkt)).size).toBe(1);
  });

  it("show a secret only as set, with the form of the newest manifest", async () => {
    expect(await json(support, APP)).toEqual({
      status: 200,
      daten: {
        app: "probe",
        version: "1.0.0",
        felder: [{ name: "PROBE_LIZENZ", typ: "geheim", pflicht: true, geheim: true }],
        werte: {},
        gesetzt: ["PROBE_LIZENZ"],
      },
    });
  });

  it("are changed by owner and technik with a reason; an empty secret keeps its value", async () => {
    const leer = await json(technik, APP, {
      method: "PUT",
      body: { werte: { PROBE_LIZENZ: "" }, grund: "nur speichern" },
    });
    expect(leer).toMatchObject({ status: 200, daten: { gesetzt: ["PROBE_LIZENZ"] } });
    const geaendert = await json(teufel, APP, {
      method: "PUT",
      body: { werte: { PROBE_LIZENZ: NEUE_LIZENZ }, grund: "neue Lizenz" },
    });
    expect(geaendert).toMatchObject({ status: 200, daten: { gesetzt: ["PROBE_LIZENZ"] } });
    const eintrag = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "app_einstellungen.aendern");
    expect(eintrag).toHaveLength(1);
    expect(eintrag[0]).toMatchObject({ grund: "neue Lizenz", akteur: teufel.nutzerId });
    expect(eintrag[0]?.inhalt).toContain("[verschlüsselt]");
  });

  it.each([
    ["a value of the wrong type", { PROBE_LIZENZ: true }, "PROBE_LIZENZ: a value of another type"],
    ["an unknown name", { X: "1" }, "X: the manifest has no such setting"],
    [
      "a value of the installation",
      { PROBE_TITEL: "x" },
      "PROBE_TITEL: a setting of another level",
    ],
  ])("refuse %s, naming it", async (_fall, werte, detail) => {
    expect(await json(teufel, APP, { method: "PUT", body: { werte, grund: "x" } })).toEqual({
      status: 400,
      daten: { fehler: "einstellung_ungueltig", detail },
    });
  });

  it("need a reason, and are not changed by support", async () => {
    expect((await json(teufel, APP, { method: "PUT", body: { werte: {} } })).status).toBe(400);
    expect(await json(support, APP, { method: "PUT", body: { werte: {}, grund: "x" } })).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
  });
});

describe("changing an installation's settings", () => {
  it("is refused before the installation runs", async () => {
    expect(
      await json(teufel, einstellungen(laufend), {
        method: "PUT",
        body: { einstellungen: { PROBE_TITEL: "Süd" }, grund: "Wunsch" },
      }),
    ).toEqual({ status: 409, daten: { fehler: "laeuft_nicht" } });
  });

  it("makes the job to configure it anew, and refuses another while it is open", async () => {
    eingerichtet(teufel.betreiberId, laufend);
    const seite = await json(technik, einstellungen(laufend), {
      method: "PUT",
      body: {
        einstellungen: { PROBE_TITEL: "Süd", PROBE_KENNWORT: NEUES_KENNWORT },
        grund: "Mail",
      },
    });
    expect(seite.status).toBe(200);
    expect(seite.daten).toMatchObject({
      einstellungen: { installation: { PROBE_TITEL: "Kanzlei" } },
      formular: { gesetzt: ["PROBE_KENNWORT"] },
    });
    expect((seite.daten.auftraege as { aktion: string }[]).at(-1)).toMatchObject({
      aktion: EINRICHTUNG_AKTIONEN.konfigurieren,
    });
    expect(
      await json(teufel, einstellungen(laufend), {
        method: "PUT",
        body: { einstellungen: {}, grund: "noch einmal" },
      }),
    ).toEqual({ status: 409, daten: { fehler: "auftrag_offen" } });
  });

  it("needs a reason and values of the form, and is not done by support", async () => {
    const pfad = einstellungen(laufend);
    expect((await json(teufel, pfad, { method: "PUT", body: { einstellungen: {} } })).status).toBe(
      400,
    );
    expect(
      await json(support, pfad, { method: "PUT", body: { einstellungen: {}, grund: "x" } }),
    ).toEqual({ status: 403, daten: { fehler: "keine_berechtigung" } });
  });
});

describe("no operator reaches another's settings", () => {
  it("GET /api/v1/apps/:app/einstellungen shows only the operator's own values", async () => {
    expect(await json(partner, APP)).toEqual({ status: 404, daten: { fehler: "kein_manifest" } });
  });

  it("PUT /api/v1/apps/:app/einstellungen changes only the operator's own values", async () => {
    const vorher = server.db.select().from(appEinstellungen).all();
    expect(
      await json(partner, APP, {
        method: "PUT",
        body: { werte: { PROBE_LIZENZ: "fremd" }, grund: "fremd" },
      }),
    ).toEqual({ status: 404, daten: { fehler: "kein_manifest" } });
    expect(server.db.select().from(appEinstellungen).all()).toEqual(vorher);
  });

  it("PUT /api/v1/installationen/:installationId/einstellungen does not configure another's", async () => {
    const vorher = server.db.select().from(installationen).all();
    expect(
      await json(partner, einstellungen(laufend), {
        method: "PUT",
        body: { einstellungen: { PROBE_TITEL: "fremd" }, grund: "fremd" },
      }),
    ).toEqual({ status: 404, daten: { fehler: "keine_installation" } });
    expect(server.db.select().from(installationen).all()).toEqual(vorher);
  });

  it("the partner's own values stay apart from the operator's", async () => {
    const kunde = await kundeAnlegen(json, partner, "Kunde des Partners");
    const eigener = await serverMitAgent(server, json, partner, []);
    const a = await json(partner, "/api/v1/installationen", {
      body: neu("partner.kanzlei.test", {
        kundeId: kunde,
        serverId: eigener,
        betreiberWerte: { PROBE_LIZENZ: PARTNER_LIZENZ },
      }),
    });
    expect(a.status).toBe(201);
    const zeilen = server.db.select().from(appEinstellungen).all();
    expect(zeilen.map((z) => z.betreiberId).sort()).toEqual(
      [teufel.betreiberId, partner.betreiberId].sort(),
    );
  });
});

describe("the secrets of the settings", () => {
  it("are in no answer, no audit entry and no byte of the database file", () => {
    server.sqlite.run("PRAGMA wal_checkpoint(FULL)");
    const datei = dateiInhalt(server.pfad);
    const text = JSON.stringify(antworten);
    const audit = JSON.stringify(server.db.select().from(auditLog).all());
    for (const g of [LIZENZ, KENNWORT, NEUE_LIZENZ, NEUES_KENNWORT, PARTNER_LIZENZ]) {
      expect(text).not.toContain(g);
      expect(audit).not.toContain(g);
      expect(datei).not.toContain(g);
    }
  });
});

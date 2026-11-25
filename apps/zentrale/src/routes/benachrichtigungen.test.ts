import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, benachrichtigungEinstellungen, empfaenger } from "../db/schema.ts";
import { versandImTest } from "../testhilfen/benachrichtigung.ts";
import { dateiInhalt } from "../testhilfen/installationen.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";
import { webhookEmpfaenger } from "../testhilfen/webhook.ts";

/*
 * BAULISTE.md Z-703 over HTTP: mail server, quiet hours and recipients, set with a reason by owner
 * and technik, read by every role; the SMTP password and a webhook's URL and key never in an answer,
 * the log or the audit log, only encrypted in the database. A test message reaches the receiver
 * signed. No operator reaches another's notifications (a test per endpoint).
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

const PASSWORT = "smtp-passwort-sehr-geheim-0815";
const SCHLUESSEL = "webhook-schluessel-1234567890abcdefghijklmnop";
const HOOK_PFAD = "/services/T000/B000/geheimer-pfad-xyz";
// Z-1105: a ntfy topic's name is its key on a public server, its token the key of a protected one
const NTFY_THEMA = "sz-geheimes-thema-4711";
const NTFY_TOKEN = "tk_ntfy-token-sehr-geheim-0815";
let server: TestServer;
let teufel: Person;
let technik: Awaited<ReturnType<TestServer["eingeladen"]>>;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
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

const SMTP = {
  host: "smtp.betreiber.test",
  port: 587,
  sicherheit: "starttls",
  benutzer: "zentrale",
  absender: "zentrale@betreiber.test",
  passwort: PASSWORT,
};
const setzen = (teil: Record<string, unknown> = {}) => ({
  smtp: SMTP,
  ruhezeit: { von: "22:00", bis: "07:00" },
  grund: "Mail eingerichtet",
  ...teil,
});
const mail = {
  art: "mail",
  adresse: "betrieb@betreiber.test",
  abSchwere: "warn",
  grund: "Bereitschaft",
};
const webhook = {
  art: "webhook",
  url: `https://hooks.chat.example${HOOK_PFAD}`,
  schluessel: SCHLUESSEL,
  abSchwere: "fehler",
  grund: "Chat",
};

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  technik = await server.eingeladen(teufel, "technik");
  support = await server.eingeladen(teufel, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
}, 60_000);

describe("the notification settings", () => {
  it("start empty", async () => {
    expect(await json(support, "/api/v1/benachrichtigungen")).toEqual({
      status: 200,
      daten: { smtp: null, ruhezeit: null, empfaenger: [], zustellungen: [] },
    });
  });

  it("are set with a reason; the password comes back only as set and is kept when left out", async () => {
    const gesetzt = await json(teufel, "/api/v1/benachrichtigungen", {
      method: "PUT",
      body: setzen(),
    });
    const { passwort: _, ...ohne } = SMTP;
    expect(gesetzt).toEqual({
      status: 200,
      daten: {
        smtp: { ...ohne, passwortGesetzt: true },
        ruhezeit: { von: "22:00", bis: "07:00" },
        empfaenger: [],
        zustellungen: [],
      },
    });
    const ohnePasswort = setzen({ smtp: ohne, grund: "Port bleibt" });
    expect(
      (await json(technik, "/api/v1/benachrichtigungen", { method: "PUT", body: ohnePasswort }))
        .daten,
    ).toEqual(gesetzt.daten);
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "benachrichtigung.einstellungen");
    expect(eintraege.map((e) => [e.akteur, e.ziel])).toEqual([
      [teufel.nutzerId, "benachrichtigungEinstellungen"],
      [teufel.nutzerId, "geheimnisse:smtp-passwort"],
      [technik.nutzerId, "benachrichtigungEinstellungen"],
    ]);
    expect(eintraege[1]?.inhalt).toContain("[verschlüsselt]");
  });

  it("refuses support, an invalid field, plain SMTP to another machine and a missing reason", async () => {
    expect(
      await json(support, "/api/v1/benachrichtigungen", { method: "PUT", body: setzen() }),
    ).toEqual({
      status: 403,
      daten: { fehler: "keine_berechtigung" },
    });
    for (const falsch of [
      { smtp: { ...SMTP, sicherheit: "keine" } },
      { smtp: { ...SMTP, host: "Smtp Server" } },
      { smtp: { ...SMTP, absender: "zentrale@betreiber.test\r\nBcc: x@y.test" } },
      { smtp: { ...SMTP, passwort: "a\r\nRCPT TO:<x@y.test>" } },
      { smtp: { ...SMTP, port: 0 } },
      { ruhezeit: { von: "22:00", bis: "22:00" } },
      { ruhezeit: { von: "24:00", bis: "07:00" } },
      { grund: " " },
      { unbekannt: 1 },
    ])
      expect(
        (await json(teufel, "/api/v1/benachrichtigungen", { method: "PUT", body: setzen(falsch) }))
          .status,
        JSON.stringify(falsch),
      ).toBe(400);
    const lokal = setzen({
      smtp: { ...SMTP, host: "localhost", sicherheit: "keine", benutzer: null },
    });
    expect(
      (await json(teufel, "/api/v1/benachrichtigungen", { method: "PUT", body: lokal })).status,
    ).toBe(200);
    // without a user the password goes too
    expect((await json(support, "/api/v1/benachrichtigungen")).daten).toMatchObject({
      smtp: { host: "localhost", benutzer: null, passwortGesetzt: false },
    });
    await json(teufel, "/api/v1/benachrichtigungen", { method: "PUT", body: setzen() });
  });
});

describe("recipients", () => {
  it("are added with a reason; a webhook shows only its origin, never URL path or key", async () => {
    const m = await json(teufel, "/api/v1/benachrichtigungen/empfaenger", { body: mail });
    expect(m).toMatchObject({
      status: 201,
      daten: { art: "mail", anzeige: "betrieb@betreiber.test", abSchwere: "warn" },
    });
    const w = await json(technik, "/api/v1/benachrichtigungen/empfaenger", { body: webhook });
    expect(w.status).toBe(201);
    expect(w.daten).toEqual({
      empfaengerId: expect.any(String),
      art: "webhook",
      anzeige: "https://hooks.chat.example",
      abSchwere: "fehler",
      angelegtAm: expect.any(Number),
    });
    expect(
      ((await json(support, "/api/v1/benachrichtigungen")).daten.empfaenger as unknown[]).length,
    ).toBe(2);
    const zeile = server.db
      .select()
      .from(empfaenger)
      .all()
      .find((z) => z.art === "webhook");
    expect(zeile?.geheim).toMatch(/^v1\.[0-9a-f]{8}\./);
  });

  it("refuse support, an http or credentialed URL, a short key and a bad address", async () => {
    expect(
      (await json(support, "/api/v1/benachrichtigungen/empfaenger", { body: mail })).status,
    ).toBe(403);
    for (const falsch of [
      { ...webhook, url: "http://hooks.chat.example/x" },
      { ...webhook, url: "https://nutzer:pw@hooks.chat.example/x" },
      { ...webhook, url: "keine-url" },
      { ...webhook, schluessel: "kurz" },
      { ...webhook, schluessel: `${"a".repeat(40)} b` },
      { ...mail, adresse: "betrieb@betreiber.test\r\nBcc: x@y.test" },
      { ...mail, adresse: "<betrieb@betreiber.test>" },
      { ...mail, abSchwere: "hinweis" },
      { ...mail, grund: "" },
    ])
      expect(
        (await json(teufel, "/api/v1/benachrichtigungen/empfaenger", { body: falsch })).status,
        JSON.stringify(falsch),
      ).toBe(400);
  });

  it("get a test message, signed, and are removed with a reason", async () => {
    const e = webhookEmpfaenger(SCHLUESSEL, { jetzt: server.jetzt });
    afterAll(() => e.stoppen());
    const angelegt = await json(teufel, "/api/v1/benachrichtigungen/empfaenger", {
      body: { ...webhook, url: e.url() },
    });
    // the API takes https only; this receiver on localhost speaks http, so the tests' way out
    // below sends the https recipient's message to it instead
    expect(angelegt.status).toBe(400);
    const ok = await json(teufel, "/api/v1/benachrichtigungen/empfaenger", { body: webhook });
    const id = String(ok.daten.empfaengerId);
    const pfad = `/api/v1/benachrichtigungen/empfaenger/${id}/test`;
    expect((await json(teufel, pfad, { body: {} })).daten).toEqual({ fehler: "kein_versand" });
    server.deps.versand = {
      ...versandImTest(),
      webhook: (ziel, n, jetzt) => versandImTest().webhook({ ...ziel, url: e.url() }, n, jetzt),
    };
    expect(await json(technik, pfad, { body: {} })).toEqual({ status: 200, daten: { ok: true } });
    expect(e.empfangen.map((x) => [x.status, x.signatur])).toEqual([[204, { ok: true }]]);
    expect(JSON.parse(e.empfangen[0]?.body ?? "{}").text).toBe(
      "[Hinweis] Testnachricht der Steuerzentrale",
    );
    e.scheitern(1);
    expect(await json(teufel, pfad, { body: {} })).toEqual({
      status: 502,
      daten: { fehler: "nicht_zugestellt", detail: "webhook HTTP 503" },
    });
    expect((await json(support, pfad, { body: {} })).status).toBe(403);
    const weg = `/api/v1/benachrichtigungen/empfaenger/${id}`;
    expect((await json(teufel, weg, { method: "DELETE", body: {} })).status).toBe(400);
    expect(
      (await teufel.json(weg, { method: "DELETE", body: { grund: "Chat abgeschaltet" } })).status,
    ).toBe(204);
    expect((await json(teufel, weg, { method: "DELETE", body: { grund: "nochmal" } })).status).toBe(
      404,
    );
    expect((await json(teufel, pfad, { body: {} })).status).toBe(404);
  });

  it("take a ntfy topic without a reason, shown only by its server's origin (Z-1105)", async () => {
    const ntfy = {
      art: "ntfy",
      url: `https://ntfy.sh/${NTFY_THEMA}`,
      token: NTFY_TOKEN,
      abSchwere: "fehler",
    };
    const n = await json(teufel, "/api/v1/benachrichtigungen/empfaenger", { body: ntfy });
    expect(n).toEqual({
      status: 201,
      daten: {
        empfaengerId: expect.any(String),
        art: "ntfy",
        anzeige: "https://ntfy.sh",
        abSchwere: "fehler",
        angelegtAm: expect.any(Number),
      },
    });
    const ohneToken = { ...ntfy, url: "https://push.example.de/ntfy/oeffentlich", token: null };
    expect(
      (await json(teufel, "/api/v1/benachrichtigungen/empfaenger", { body: ohneToken })).status,
    ).toBe(201);
    for (const falsch of [
      { ...ntfy, url: `http://ntfy.sh/${NTFY_THEMA}` },
      { ...ntfy, url: "https://ntfy.sh/" },
      { ...ntfy, url: `https://ntfy.sh/${NTFY_THEMA}?x=1` },
      { ...ntfy, url: `https://kim:pw@ntfy.sh/${NTFY_THEMA}` },
      { ...ntfy, token: "mit leerzeichen" },
    ])
      expect(
        (await json(teufel, "/api/v1/benachrichtigungen/empfaenger", { body: falsch })).status,
        JSON.stringify(falsch),
      ).toBe(400);
    expect(
      (await json(support, "/api/v1/benachrichtigungen/empfaenger", { body: ntfy })).status,
    ).toBe(403);
  });

  it("never show a secret in an answer, the log, the audit log or the database file", () => {
    const alles = JSON.stringify(antworten);
    const audit = JSON.stringify(server.db.select().from(auditLog).all());
    for (const geheim of [PASSWORT, SCHLUESSEL, HOOK_PFAD, NTFY_THEMA, NTFY_TOKEN]) {
      expect(alles, geheim).not.toContain(geheim);
      expect(server.log.join("\n"), geheim).not.toContain(geheim);
      expect(audit, geheim).not.toContain(geheim);
      expect(dateiInhalt(server.pfad), geheim).not.toContain(geheim);
    }
  });
});

describe("no operator reaches another's notifications", () => {
  it("GET /api/v1/benachrichtigungen shows one's own only", async () => {
    expect((await json(partner, "/api/v1/benachrichtigungen")).daten).toEqual({
      smtp: null,
      ruhezeit: null,
      empfaenger: [],
      zustellungen: [],
    });
  });

  it("PUT /api/v1/benachrichtigungen sets one's own only", async () => {
    const vorher = server.db.select().from(benachrichtigungEinstellungen).all();
    await json(partner, "/api/v1/benachrichtigungen", {
      method: "PUT",
      body: setzen({ smtp: { ...SMTP, host: "smtp.partner.test" } }),
    });
    const nachher = server.db.select().from(benachrichtigungEinstellungen).all();
    expect(nachher.find((z) => z.betreiberId === teufel.betreiberId)).toEqual(
      vorher.find((z) => z.betreiberId === teufel.betreiberId),
    );
    expect((await json(teufel, "/api/v1/benachrichtigungen")).daten).toMatchObject({
      smtp: { host: "smtp.betreiber.test" },
    });
  });

  it("POST /api/v1/benachrichtigungen/empfaenger adds to one's own only", async () => {
    const neu = await json(partner, "/api/v1/benachrichtigungen/empfaenger", {
      body: { ...mail, adresse: "pia@partner.test" },
    });
    expect(neu.status).toBe(201);
    const eigene = (await json(teufel, "/api/v1/benachrichtigungen")).daten.empfaenger as {
      anzeige: string;
    }[];
    expect(eigene.map((r) => r.anzeige)).not.toContain("pia@partner.test");
  });

  it("DELETE and test of /api/v1/benachrichtigungen/empfaenger/:id do not reach another's", async () => {
    const vorher = (await json(teufel, "/api/v1/benachrichtigungen")).daten.empfaenger as {
      empfaengerId: string;
    }[];
    const pfad = `/api/v1/benachrichtigungen/empfaenger/${vorher[0]?.empfaengerId}`;
    expect((await json(partner, `${pfad}/test`, { body: {} })).status).toBe(404);
    expect((await json(partner, pfad, { method: "DELETE", body: { grund: "fremd" } })).status).toBe(
      404,
    );
    expect((await json(teufel, "/api/v1/benachrichtigungen")).daten.empfaenger).toEqual(vorher);
  });
});

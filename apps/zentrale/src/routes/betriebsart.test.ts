import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, installationen } from "../db/schema.ts";
import { schreiben } from "../modules/audit/index.ts";
import { KENNWORT, LIZENZ } from "../testhilfen/installationen.ts";
import {
  BEGINN,
  kundeAnlegen,
  manifestHochladen,
  serverMitAgent,
} from "../testhilfen/installationen-api.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-805 over HTTP: the Betriebsart. Only the owner switches; `selbst` makes one internal
 * customer, is refused while another customer's installation exists, and closes the endpoints for
 * customers with `409 betriebsart`; switching back and forth keeps every installation, each switch
 * in the audit log with its reason; another operator stays untouched.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Antwort = { status: number; daten: Record<string, unknown> };

let server: TestServer;
let inhaber: Person;
let technik: Awaited<ReturnType<TestServer["eingeladen"]>>;
let support: Awaited<ReturnType<TestServer["eingeladen"]>>;
let partner: Person;
let serverId: string;

const json = async (p: Pick<Person, "json">, pfad: string, init?: Parameters<Person["json"]>[1]) =>
  (await p.json(pfad, init)) as Antwort;

const setzen = (p: Pick<Person, "json">, betriebsart: string, grund?: string) =>
  json(p, "/api/v1/betriebsart", {
    method: "PUT",
    body: { betriebsart, ...(grund === undefined ? {} : { grund }) },
  });

const ich = async (p: Pick<Person, "json">) =>
  (await json(p, "/api/v1/ich")).daten.betreiber as Record<string, unknown>;

const installieren = (kundeId: string, host: string) =>
  json(inhaber, "/api/v1/installationen", {
    body: {
      kundeId,
      serverId,
      app: "probe",
      version: "1.0.0",
      optionen: [],
      host,
      einstellungen: { PROBE_TITEL: "Eigen", PROBE_KENNWORT: KENNWORT },
      betreiberWerte: { PROBE_LIZENZ: LIZENZ },
      grund: "Auftrag",
    },
  });

beforeAll(async () => {
  server = testServer(afterAll);
  inhaber = await server.inhaber();
  technik = await server.eingeladen(inhaber, "technik");
  support = await server.eingeladen(inhaber, "support");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  serverId = await serverMitAgent(server, json, inhaber, []);
  await manifestHochladen(json, inhaber);
}, 60_000);

describe("the Betriebsart", () => {
  it("is unset for a new operator and answered once without a reason", async () => {
    expect(await ich(inhaber)).toMatchObject({ betriebsart: null, eigenerKundeId: null });
    expect(await setzen(inhaber, "kunden")).toEqual({
      status: 200,
      daten: { betriebsart: "kunden", eigenerKundeId: null },
    });
    const eintrag = server.db
      .select()
      .from(auditLog)
      .all()
      .find((e) => e.aktion === "betriebsart.kunden");
    expect(eintrag?.grund).toBe("Erste Einrichtung");
    // once answered, a change needs a reason
    expect((await setzen(inhaber, "selbst")).status).toBe(400);
  });

  it("is switched only by the owner (a test per role)", async () => {
    expect(await setzen(technik, "selbst", "Grund")).toMatchObject({ status: 403 });
    expect(await setzen(support, "selbst", "Grund")).toMatchObject({ status: 403 });
    expect(await ich(technik)).toMatchObject({ betriebsart: "kunden" });
    expect(await ich(support)).toMatchObject({ betriebsart: "kunden" });
  });

  it("refuses `selbst` while an installation belongs to another customer", async () => {
    const fremd = await kundeAnlegen(json, inhaber);
    const angelegt = await installieren(fremd, "fremd.kanzlei.test");
    expect(angelegt.status).toBe(201);
    expect(await setzen(inhaber, "selbst", "Nur noch eigene Apps")).toEqual({
      status: 409,
      daten: { fehler: "fremde_installationen" },
    });
    expect(await ich(inhaber)).toMatchObject({ betriebsart: "kunden" });
    // removed, it no longer stands in the way
    const installationId = String(angelegt.daten.installationId);
    const betreiberId = String((await ich(inhaber)).betreiberId);
    schreiben(
      server.schreibDb,
      { betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
      "test",
      (s) => s.aendern("installationen", { installationId }, { zustand: "entfernt" }),
    );
  });

  it("switches to `selbst` with an internal customer and back without losing anything", async () => {
    const r = await setzen(inhaber, "selbst", "Nur noch eigene Apps");
    expect(r.status).toBe(200);
    const eigener = String(r.daten.eigenerKundeId);
    const kunde = await json(inhaber, `/api/v1/kunden/${eigener}`);
    expect(kunde.daten).toMatchObject({ intern: true });
    expect((await installieren(eigener, "eigen.teufel.test")).status).toBe(201);
    const vorher = server.db.select().from(installationen).all().length;

    expect(await setzen(inhaber, "kunden", "Doch Hosting")).toMatchObject({
      status: 200,
      daten: { betriebsart: "kunden", eigenerKundeId: eigener },
    });
    // back to `selbst` reuses the internal customer
    expect(await setzen(inhaber, "selbst", "Wieder für mich")).toMatchObject({
      status: 200,
      daten: { betriebsart: "selbst", eigenerKundeId: eigener },
    });
    expect(server.db.select().from(installationen).all()).toHaveLength(vorher);
    const wechsel = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion.startsWith("betriebsart."))
      .map((e) => [e.aktion, e.grund]);
    expect(wechsel).toEqual(
      expect.arrayContaining([
        ["betriebsart.selbst", "Nur noch eigene Apps"],
        ["betriebsart.kunden", "Doch Hosting"],
        ["betriebsart.selbst", "Wieder für mich"],
      ]),
    );
  });

  it("answers `409 betriebsart` on the endpoints for customers in `selbst`", async () => {
    const kunde = { name: "X", kontakt: { name: "K", email: "k@x.test" } };
    const eigener = String((await ich(inhaber)).eigenerKundeId);
    const anfragen: [string, string, Record<string, unknown>?][] = [
      ["POST", "/api/v1/kunden", { ...kunde, vertrag: { beginn: BEGINN }, grund: "g" }],
      ["PUT", `/api/v1/kunden/${eigener}`, { ...kunde, beginn: BEGINN, grund: "g" }],
      ["PUT", `/api/v1/kunden/${eigener}/kuendigung`, { ende: BEGINN, grund: "g" }],
      ["DELETE", `/api/v1/kunden/${eigener}/kuendigung`, { grund: "g" }],
      ["PUT", `/api/v1/kunden/${eigener}/intern`, { intern: false, grund: "g" }],
      ["POST", "/api/v1/support-zugaenge", { installationId: "x", dauer: 30, grund: "g" }],
    ];
    for (const [method, pfad, body] of anfragen)
      expect(await json(inhaber, pfad, { method, ...(body ? { body } : {}) })).toEqual({
        status: 409,
        daten: { fehler: "betriebsart" },
      });
    const fremd = (await json(inhaber, "/api/v1/kunden")).daten.kunden as { id: string }[];
    const anderer = fremd.find((k) => k.id !== eigener)?.id ?? "";
    expect(await installieren(anderer, "anders.teufel.test")).toEqual({
      status: 409,
      daten: { fehler: "betriebsart" },
    });
    // reads the remaining interface needs keep working
    expect((await json(support, "/api/v1/kunden")).status).toBe(200);
    expect((await json(support, "/api/v1/installationen")).status).toBe(200);
  });

  it("leaves another operator untouched", async () => {
    expect(await ich(partner)).toMatchObject({ betriebsart: null, eigenerKundeId: null });
    const kunden = (await json(partner, "/api/v1/kunden")).daten.kunden as unknown[];
    expect(kunden).toEqual([]);
  });
});

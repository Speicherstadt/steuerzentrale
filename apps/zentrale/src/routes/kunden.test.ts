import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, kunden, vertraege } from "../db/schema.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-801: customers with contact and a contract with beginning and notice date (no SLA since Z-1202); every write
 * with a reason, through `schreiben`, so each change stands in the audit log.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;

const TAG = 86_400_000;
// 01.12.2026 00:00 in Berlin: a contract day is the start of a Berlin day
const BEGINN = Date.UTC(2026, 10, 30, 23);

const neuerKunde = (name = "Atelier Nord") => ({
  name,
  kontakt: { name: "Anna Nord", email: "buero@atelier-nord.test", telefon: "+49 40 123456" },
  notiz: "Zahlt per Rechnung",
  vertrag: { beginn: BEGINN },
  grund: "Vertrag vom 20.11.",
});

type KundeAntwort = {
  id: string;
  name: string;
  kontakt: { name: string; email: string; telefon: string | null };
  notiz: string | null;
  kuerzel: string;
  kuerzelAenderbar: boolean;
  angelegtAm: number;
  vertrag: { beginn: number; ende: number | null };
};

let server: TestServer;
let inhaber: Person;

beforeAll(async () => {
  server = testServer(afterAll);
  inhaber = await server.inhaber();
}, 60_000);

const anlegen = async (person: Pick<Person, "json"> = inhaber, name?: string) => {
  const { status, daten } = await person.json("/api/v1/kunden", { body: neuerKunde(name) });
  if (status !== 201) throw new Error(`anlegen ${status} ${JSON.stringify(daten)}`);
  return daten as KundeAntwort;
};

const letzterEintrag = () => server.db.select().from(auditLog).all().at(-1);

describe("a customer", () => {
  it("is created with contact, note and a contract without SLA, and listed", async () => {
    const kunde = await anlegen(inhaber, "Liste GmbH");
    expect(kunde).toEqual({
      id: expect.any(String),
      name: "Liste GmbH",
      kontakt: { name: "Anna Nord", email: "buero@atelier-nord.test", telefon: "+49 40 123456" },
      notiz: "Zahlt per Rechnung",
      kuerzel: "liste-gmbh",
      kuerzelAenderbar: true,
      intern: false,
      angelegtAm: server.jetzt(),
      vertrag: { beginn: BEGINN, ende: null },
    });
    const { daten } = await inhaber.json("/api/v1/kunden");
    expect((daten as { kunden: KundeAntwort[] }).kunden).toContainEqual(kunde);
    expect((await inhaber.json(`/api/v1/kunden/${kunde.id}`)).daten).toEqual(kunde);
  });

  it("is listed by name", async () => {
    await anlegen(inhaber, "Zeta KG");
    await anlegen(inhaber, "Alpha AG");
    const { daten } = await inhaber.json("/api/v1/kunden");
    const namen = (daten as { kunden: KundeAntwort[] }).kunden.map((k) => k.name);
    expect(namen).toEqual([...namen].sort((a, b) => a.localeCompare(b, "de")));
  });

  it("stands in the audit log with actor, reason and its contract", async () => {
    const vorher = server.db.select().from(auditLog).all().length;
    const kunde = await anlegen();
    const neu = server.db.select().from(auditLog).all().slice(vorher);
    expect(neu.map((e) => [e.aktion, e.ziel.split(":")[0], e.akteur, e.grund])).toEqual([
      ["kunde.anlegen", "kunden", inhaber.nutzerId, "Vertrag vom 20.11."],
      ["kunde.anlegen", "vertraege", inhaber.nutzerId, "Vertrag vom 20.11."],
    ]);
    expect(neu[0]?.ziel).toBe(`kunden:${kunde.id}`);
  });

  it("knows no SLA any more (Z-1202): neither takes nor answers one", async () => {
    for (const sla of ["basis", "plus", "ruhe"]) {
      const body = { ...neuerKunde(), vertrag: { sla, beginn: BEGINN } };
      expect((await inhaber.json("/api/v1/kunden", { body })).status, sla).toBe(400);
    }
    const kunde = await anlegen();
    const antworten = [
      kunde,
      (await inhaber.json("/api/v1/kunden")).daten,
      (await inhaber.json(`/api/v1/kunden/${kunde.id}`)).daten,
    ];
    for (const daten of antworten) expect(JSON.stringify(daten)).not.toMatch(/"sla"/);
  });

  it("needs valid fields for every write", async () => {
    const falsch = [
      { ...neuerKunde(), name: "" },
      { ...neuerKunde(), kontakt: { name: "A", email: "keine-adresse" } },
      { ...neuerKunde(), unbekannt: 1 },
      { ...neuerKunde(), vertrag: { beginn: -1 } },
    ];
    const vorher = server.db.select().from(kunden).all().length;
    for (const body of falsch)
      expect((await inhaber.json("/api/v1/kunden", { body })).status, JSON.stringify(body)).toBe(
        400,
      );
    expect(server.db.select().from(kunden).all()).toHaveLength(vorher);
    const kunde = await anlegen();
    const pfad = `/api/v1/kunden/${kunde.id}`;
    expect((await inhaber.json(pfad, { method: "PUT", body: { name: "X" } })).status).toBe(400);
    expect(
      (await inhaber.json(`${pfad}/kuendigung`, { method: "PUT", body: { ende: -1 } })).status,
    ).toBe(400);
  });

  it("takes every write without a reason, with an empty one in the audit log (Z-1207)", async () => {
    const letzter = () => server.db.select().from(auditLog).all().at(-1);
    const { grund: _, ...ohneGrund } = neuerKunde("Ohne Grund GmbH");
    const neu = await inhaber.json("/api/v1/kunden", { body: ohneGrund });
    expect(neu.status).toBe(201);
    expect(letzter()).toMatchObject({ aktion: "kunde.anlegen", grund: "" });
    const pfad = `/api/v1/kunden/${(neu.daten as KundeAntwort).id}`;
    const { vertrag: _v, ...stamm } = ohneGrund;
    const schritte: [string, string, Record<string, unknown>, string][] = [
      ["PUT", pfad, { ...stamm, name: "Ohne Grund AG", beginn: BEGINN }, "kunde.aendern"],
      ["PUT", `${pfad}/kuendigung`, { ende: BEGINN + 400 * TAG }, "vertrag.kuendigen"],
      ["DELETE", `${pfad}/kuendigung`, {}, "vertrag.zuruecknehmen"],
      ["PUT", `${pfad}/intern`, { intern: true }, "kunde.intern"],
    ];
    for (const [method, ziel, body, aktion] of schritte) {
      const r = await inhaber.json(ziel, { method, body });
      expect(r.status, `${method} ${ziel} ${JSON.stringify(r.daten)}`).toBe(200);
      expect(letzter(), aktion).toMatchObject({ aktion, grund: "" });
    }
  });

  it("is changed with a reason, and only what changed stands in the audit log", async () => {
    const kunde = await anlegen();
    const { status, daten } = await inhaber.json(`/api/v1/kunden/${kunde.id}`, {
      method: "PUT",
      body: {
        name: "Atelier Nord GmbH",
        kontakt: { name: "Anna Nord", email: "anna@atelier-nord.test" },
        beginn: BEGINN + TAG,
        grund: "Umfirmierung",
      },
    });
    expect(status).toBe(200);
    expect(daten).toEqual({
      ...kunde,
      name: "Atelier Nord GmbH",
      kontakt: { name: "Anna Nord", email: "anna@atelier-nord.test", telefon: null },
      notiz: null,
      vertrag: { beginn: BEGINN + TAG, ende: null },
    });
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "kunde.aendern" && e.grund === "Umfirmierung");
    expect(eintraege.map((e) => JSON.parse(e.inhalt).werte)).toEqual([
      {
        name: "Atelier Nord GmbH",
        kontaktEmail: "anna@atelier-nord.test",
        kontaktTelefon: null,
        notiz: null,
      },
      { beginn: BEGINN + TAG },
    ]);
  });

  it("writes nothing when a change changes nothing", async () => {
    const kunde = await anlegen();
    const vorher = server.db.select().from(auditLog).all().length;
    const { grund: _, vertrag, ...gleich } = neuerKunde();
    const antwort = await inhaber.json(`/api/v1/kunden/${kunde.id}`, {
      method: "PUT",
      body: { ...gleich, beginn: vertrag.beginn, grund: "nichts" },
    });
    expect(antwort).toEqual({ status: 200, daten: kunde });
    expect(server.db.select().from(auditLog).all()).toHaveLength(vorher);
  });

  it("gets a notice date and loses it again, each with a reason in the audit log", async () => {
    const kunde = await anlegen();
    const pfad = `/api/v1/kunden/${kunde.id}/kuendigung`;
    const ende = BEGINN + 100 * TAG;
    const gekuendigt = await inhaber.json(pfad, {
      method: "PUT",
      body: { ende, grund: "Kündigung per Mail vom 18.11." },
    });
    expect(gekuendigt).toEqual({
      status: 200,
      daten: { ...kunde, vertrag: { ...kunde.vertrag, ende } },
    });
    expect(letzterEintrag()).toMatchObject({
      aktion: "vertrag.kuendigen",
      grund: "Kündigung per Mail vom 18.11.",
      akteur: inhaber.nutzerId,
    });
    expect(JSON.parse(letzterEintrag()?.inhalt ?? "{}").werte).toEqual({ ende });

    const zurueck = await inhaber.json(pfad, {
      method: "DELETE",
      body: { grund: "Kunde bleibt doch" },
    });
    expect(zurueck).toEqual({ status: 200, daten: kunde });
    expect(letzterEintrag()).toMatchObject({
      aktion: "vertrag.zuruecknehmen",
      grund: "Kunde bleibt doch",
    });
    expect(server.db.select().from(vertraege).all()).toContainEqual(
      expect.objectContaining({ kundeId: kunde.id, ende: null }),
    );
  });

  it("cannot end before its contract began", async () => {
    const kunde = await anlegen();
    const pfad = `/api/v1/kunden/${kunde.id}`;
    const frueh = await inhaber.json(`${pfad}/kuendigung`, {
      method: "PUT",
      body: { ende: BEGINN - TAG, grund: "zu früh" },
    });
    expect(frueh).toEqual({ status: 409, daten: { fehler: "ende_vor_beginn" } });
    await inhaber.json(`${pfad}/kuendigung`, {
      method: "PUT",
      body: { ende: BEGINN + TAG, grund: "gekündigt" },
    });
    const { grund: _, vertrag: __, ...daten } = neuerKunde();
    const spaet = await inhaber.json(pfad, {
      method: "PUT",
      body: { ...daten, beginn: BEGINN + 2 * TAG, grund: "Beginn nach dem Ende" },
    });
    expect(spaet).toEqual({ status: 409, daten: { fehler: "ende_vor_beginn" } });
  });

  it("takes a contract day only as the start of a Berlin day", async () => {
    // 01.12.2026 12:00 in Berlin is a time, not a day: stored as is, the notice to the day the
    // contract began (BEGINN) would be refused as before its start
    const mittag = BEGINN + 12 * 3_600_000;
    const vorher = server.db.select().from(kunden).all().length;
    const versuch = await inhaber.json("/api/v1/kunden", {
      body: { ...neuerKunde(), vertrag: { beginn: mittag } },
    });
    expect(versuch).toEqual({ status: 400, daten: { fehler: "ungueltig" } });
    expect(server.db.select().from(kunden).all()).toHaveLength(vorher);
    const kunde = await anlegen();
    const pfad = `/api/v1/kunden/${kunde.id}`;
    const { grund: _, vertrag: __, ...daten } = neuerKunde();
    expect(
      (await inhaber.json(pfad, { method: "PUT", body: { ...daten, beginn: mittag, grund: "x" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await inhaber.json(`${pfad}/kuendigung`, {
          method: "PUT",
          body: { ende: mittag, grund: "x" },
        })
      ).status,
    ).toBe(400);
    // the start of a Berlin day in summer time is one too
    const sommer = Date.UTC(2027, 6, 31, 22);
    expect(
      (
        await inhaber.json(`${pfad}/kuendigung`, {
          method: "PUT",
          body: { ende: sommer, grund: "x" },
        })
      ).status,
    ).toBe(200);
  });

  it("is unknown by an id that does not exist", async () => {
    const pfad = "/api/v1/kunden/gibt-es-nicht";
    const { grund: _, vertrag, ...daten } = neuerKunde();
    expect((await inhaber.json(pfad)).status).toBe(404);
    expect(
      (
        await inhaber.json(pfad, {
          method: "PUT",
          body: { ...daten, beginn: vertrag.beginn, grund: "x" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await inhaber.json(`${pfad}/kuendigung`, {
          method: "PUT",
          body: { ende: BEGINN, grund: "x" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await inhaber.json(`${pfad}/kuendigung`, { method: "DELETE", body: { grund: "x" } })).status,
    ).toBe(404);
  });
});

// Z-407: the short name in the addresses `<app>.<kuerzel>.<domain>`
describe("a customer's short name", () => {
  it("is suggested from the name, or taken as given, and then refused for another", async () => {
    const vorgeschlagen = await anlegen(inhaber, "Müller & Söhne");
    expect(vorgeschlagen.kuerzel).toBe("mueller-soehne");
    const body = { ...neuerKunde("Eigenes Kürzel"), kuerzel: "eigen-1" };
    const eigen = await inhaber.json("/api/v1/kunden", { body });
    expect(eigen).toMatchObject({ status: 201, daten: { kuerzel: "eigen-1" } });
    expect(await inhaber.json("/api/v1/kunden", { body })).toEqual({
      status: 409,
      daten: { fehler: "kuerzel_vergeben" },
    });
    const { grund: _, vertrag, ...daten } = neuerKunde("Müller & Söhne");
    const aendern = (kuerzel: string) =>
      inhaber.json(`/api/v1/kunden/${vorgeschlagen.id}`, {
        method: "PUT",
        body: { ...daten, kuerzel, beginn: vertrag.beginn, grund: "neues Kürzel" },
      });
    expect(await aendern("eigen-1")).toEqual({
      status: 409,
      daten: { fehler: "kuerzel_vergeben" },
    });
    expect(await aendern("muesoe")).toMatchObject({ status: 200, daten: { kuerzel: "muesoe" } });
  });

  it("takes only lower-case letters, digits and inner hyphens, up to 30", async () => {
    for (const kuerzel of ["", "Gross", "-a", "a-", "a.b", "ä", "a".repeat(31)]) {
      const body = { ...neuerKunde(), kuerzel };
      expect((await inhaber.json("/api/v1/kunden", { body })).status, kuerzel).toBe(400);
    }
  });
});

describe("the roles", () => {
  it("let inhaber2 write and mitglied only read", async () => {
    const inhaber2 = await server.eingeladen(inhaber, "inhaber");
    const mitglied = await server.eingeladen(inhaber, "mitglied");
    const kunde = await anlegen(inhaber2, "Von Technik");
    expect(letzterEintrag()).toMatchObject({ akteur: inhaber2.nutzerId });
    expect((await mitglied.json(`/api/v1/kunden/${kunde.id}`)).daten).toEqual(kunde);
    const versuch = await mitglied.json("/api/v1/kunden", { body: neuerKunde() });
    expect(versuch).toEqual({ status: 403, daten: { fehler: "keine_berechtigung" } });
  });
});

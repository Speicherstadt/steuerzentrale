import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, auftraege, dienste } from "../db/schema.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * BAULISTE.md Z-1101: observed services through the API. The owner makes, changes and removes
 * them, every role reads them (BAULISTE.md, Stufe 2: owner writes, both read); the address is
 * `https://<host>` and nothing else; no operator sees or changes another's (docs/entwicklung.md:
 * a test per endpoint); nothing asks for a reason; no job for an agent ever comes of it.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;
type Dienst = { id: string; name: string; adresse: string; pfad: string; kundeId: string | null };

let server: TestServer;
let teufel: Person;
let mitglied: Pick<Person, "json">;
let partner: Person;

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  mitglied = await server.eingeladen(teufel, "mitglied");
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
}, 60_000);

const anlegen = async (wer: Pick<Person, "json">, body: Record<string, unknown>) => {
  const r = await wer.json("/api/v1/dienste", { body });
  return { status: r.status, dienst: r.daten as Dienst & { fehler?: string } };
};

describe("observed services", () => {
  it("are made, listed, changed and removed by the owner, each in the audit log", async () => {
    const neu = await anlegen(teufel, { name: "Wiki", adresse: "https://Wiki.Teufel-IT.de/" });
    expect(neu.status).toBe(201);
    expect(neu.dienst).toMatchObject({
      name: "Wiki",
      adresse: "https://wiki.teufel-it.de",
      pfad: "/",
      kundeId: null,
      aussen: null,
    });
    const id = neu.dienst.id;
    const liste = await teufel.json("/api/v1/dienste");
    expect((liste.daten as { dienste: Dienst[] }).dienste.map((d) => d.id)).toEqual([id]);

    const geaendert = await teufel.json(`/api/v1/dienste/${id}`, {
      method: "PUT",
      body: { name: "Wiki intern", adresse: "https://wiki.teufel-it.de", pfad: "/health" },
    });
    expect(geaendert).toMatchObject({
      status: 200,
      daten: { name: "Wiki intern", pfad: "/health" },
    });

    const weg = await teufel.json(`/api/v1/dienste/${id}`, { method: "DELETE" });
    expect(weg.status).toBe(204);
    expect((await teufel.json("/api/v1/dienste")).daten).toEqual({ dienste: [] });
    expect((await teufel.json(`/api/v1/dienste/${id}`, { method: "DELETE" })).status).toBe(404);

    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.ziel === `dienste:${id}`)
      .map((e) => [e.betreiberId, e.aktion]);
    expect(eintraege).toEqual([
      [teufel.betreiberId, "dienst.anlegen"],
      [teufel.betreiberId, "dienst.aendern"],
      [teufel.betreiberId, "dienst.entfernen"],
    ]);
    expect(server.db.select().from(auftraege).all()).toEqual([]);
  });

  it("take one of the operator's customers, and no other", async () => {
    const kunde = await teufel.json("/api/v1/kunden", {
      body: {
        name: "Kanzlei Kim",
        kontakt: { name: "Kim", email: "kim@kanzlei.test" },
        vertrag: { beginn: Date.UTC(2026, 10, 30, 23) },
        grund: "Vertrag",
      },
    });
    const kundeId = (kunde.daten as { id: string }).id;
    const mit = await anlegen(teufel, {
      name: "Shop",
      adresse: "https://shop.kanzlei.de",
      kundeId,
    });
    expect(mit).toMatchObject({ status: 201, dienst: { kundeId } });
    const fremd = await anlegen(partner, {
      name: "Shop",
      adresse: "https://shop.kanzlei.de",
      kundeId,
    });
    expect(fremd).toMatchObject({ status: 404, dienst: { fehler: "kein_kunde" } });
  });

  it.each([
    { name: "Wiki", adresse: "http://wiki.teufel-it.de" },
    { name: "Wiki", adresse: "https://wiki.teufel-it.de:8443" },
    { name: "Wiki", adresse: "https://wiki.teufel-it.de/health" },
    { name: "Wiki", adresse: "https://kim@wiki.teufel-it.de" },
    { name: "Wiki", adresse: "https://203.0.113.10" },
    { name: "Wiki", adresse: "https://wiki.teufel-it.de", pfad: "health" },
    { name: "", adresse: "https://wiki.teufel-it.de" },
    { name: "Wiki", adresse: "https://wiki.teufel-it.de", grund: "unnötig" },
  ])("refuses %o with 400", async (body) => {
    expect((await anlegen(teufel, body)).status).toBe(400);
  });

  it("are read by every role and written by the owner only", async () => {
    const { dienst } = await anlegen(teufel, {
      name: "Status",
      adresse: "https://status.teufel-it.de",
    });
    for (const wer of [mitglied]) {
      const liste = (await wer.json("/api/v1/dienste")).daten as { dienste: Dienst[] };
      expect(liste.dienste.map((d) => d.id)).toContain(dienst.id);
      expect((await anlegen(wer, { name: "X", adresse: "https://x.teufel-it.de" })).status).toBe(
        403,
      );
      const aendern = await wer.json(`/api/v1/dienste/${dienst.id}`, {
        method: "PUT",
        body: { name: "X", adresse: "https://x.teufel-it.de", pfad: "/" },
      });
      expect(aendern.status).toBe(403);
      expect((await wer.json(`/api/v1/dienste/${dienst.id}`, { method: "DELETE" })).status).toBe(
        403,
      );
    }
  });
});

describe("no operator reaches another's observed services", () => {
  let fremdId: string;

  beforeAll(async () => {
    fremdId = (await anlegen(teufel, { name: "Intern", adresse: "https://intern.teufel-it.de" }))
      .dienst.id;
  });

  const unveraendert = () => {
    expect(server.db.select().from(dienste).all()).toContainEqual(
      expect.objectContaining({
        betreiberId: teufel.betreiberId,
        dienstId: fremdId,
        name: "Intern",
        entferntAm: null,
      }),
    );
  };

  it("GET /api/v1/dienste lists one's own services only", async () => {
    const { daten } = await partner.json("/api/v1/dienste");
    expect(JSON.stringify(daten)).not.toContain(fremdId);
  });

  it("POST /api/v1/dienste makes a service of one's own operator only", async () => {
    const { dienst } = await anlegen(partner, { name: "Shop", adresse: "https://shop.partner.de" });
    expect(server.db.select().from(dienste).all()).toContainEqual(
      expect.objectContaining({ dienstId: dienst.id, betreiberId: partner.betreiberId }),
    );
    expect(JSON.stringify((await teufel.json("/api/v1/dienste")).daten)).not.toContain(dienst.id);
  });

  it("PUT /api/v1/dienste/:dienstId does not change another's service", async () => {
    const r = await partner.json(`/api/v1/dienste/${fremdId}`, {
      method: "PUT",
      body: { name: "Übernommen", adresse: "https://boese.partner.de", pfad: "/" },
    });
    expect(r).toEqual({ status: 404, daten: { fehler: "kein_dienst" } });
    unveraendert();
  });

  it("DELETE /api/v1/dienste/:dienstId does not remove another's service", async () => {
    const r = await partner.json(`/api/v1/dienste/${fremdId}`, { method: "DELETE" });
    expect(r).toEqual({ status: 404, daten: { fehler: "kein_dienst" } });
    unveraendert();
  });
});

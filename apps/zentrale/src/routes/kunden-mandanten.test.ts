import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, kunden, vertraege } from "../db/schema.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";

/*
 * No operator reaches another's customers (BAULISTE.md Z-801; CLAUDE.md, "Project specifics": a
 * test per endpoint). The partner knows the id of Teufel IT's customer and tries every route on it.
 */
type Person = Awaited<ReturnType<TestServer["inhaber"]>>;

// 01.12.2026 00:00 in Berlin, the start of a Berlin day
const BEGINN = Date.UTC(2026, 10, 30, 23);
const TAG = 86_400_000;
const daten = (name: string) => ({
  name,
  kontakt: { name: "Kim Kunde", email: "kim@kunde.test" },
  vertrag: { sla: "basis", beginn: BEGINN },
  grund: "Vertrag",
});

let server: TestServer;
let teufel: Person;
let partner: Person;
let fremdId: string;

beforeAll(async () => {
  server = testServer(afterAll);
  teufel = await server.inhaber();
  partner = await server.weitererBetreiber("Partner GmbH", "pia@partner.test");
  const { daten: kunde } = await teufel.json("/api/v1/kunden", { body: daten("Kunde von Teufel") });
  fremdId = (kunde as { id: string }).id;
}, 60_000);

/** The customer of Teufel IT as stored, untouched by the partner */
const unveraendert = () => {
  expect(server.db.select().from(kunden).all()).toContainEqual(
    expect.objectContaining({
      betreiberId: teufel.betreiberId,
      kundeId: fremdId,
      name: "Kunde von Teufel",
    }),
  );
  expect(server.db.select().from(vertraege).all()).toContainEqual(
    expect.objectContaining({ betreiberId: teufel.betreiberId, kundeId: fremdId, ende: null }),
  );
  expect(
    server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.betreiberId === partner.betreiberId && e.ziel.includes(fremdId)),
  ).toEqual([]);
};

describe("no operator reaches another's customers", () => {
  it("GET /api/v1/kunden lists one's own customers only", async () => {
    const { daten: liste } = await partner.json("/api/v1/kunden");
    expect(liste).toEqual({ kunden: [] });
    expect(JSON.stringify((await teufel.json("/api/v1/kunden")).daten)).toContain(fremdId);
  });

  it("GET /api/v1/kunden/:kundeId does not show another's customer", async () => {
    expect(await partner.json(`/api/v1/kunden/${fremdId}`)).toEqual({
      status: 404,
      daten: { fehler: "kein_kunde" },
    });
  });

  it("POST /api/v1/kunden creates a customer of one's own operator only", async () => {
    const { daten: kunde } = await partner.json("/api/v1/kunden", { body: daten("Vom Partner") });
    const id = (kunde as { id: string }).id;
    expect(server.db.select().from(kunden).all()).toContainEqual(
      expect.objectContaining({ kundeId: id, betreiberId: partner.betreiberId }),
    );
    expect((await teufel.json(`/api/v1/kunden/${id}`)).status).toBe(404);
    expect(JSON.stringify((await teufel.json("/api/v1/kunden")).daten)).not.toContain(id);
  });

  it("PUT /api/v1/kunden/:kundeId does not change another's customer", async () => {
    const { grund: _, vertrag, ...rest } = daten("Übernommen");
    const antwort = await partner.json(`/api/v1/kunden/${fremdId}`, {
      method: "PUT",
      body: { ...rest, beginn: vertrag.beginn, grund: "fremd" },
    });
    expect(antwort.status).toBe(404);
    unveraendert();
  });

  // Z-407: the short name is unique within one operator only, and only its own operator changes it
  it("PUT /api/v1/kunden/:kundeId does not change another's short name", async () => {
    const { grund: _, vertrag, ...rest } = daten("Kunde von Teufel");
    const antwort = await partner.json(`/api/v1/kunden/${fremdId}`, {
      method: "PUT",
      body: { ...rest, kuerzel: "uebernommen", beginn: vertrag.beginn, grund: "fremd" },
    });
    expect(antwort).toEqual({ status: 404, daten: { fehler: "kein_kunde" } });
    expect(server.db.select().from(kunden).all()).toContainEqual(
      expect.objectContaining({ kundeId: fremdId, kuerzel: "kunde-von-teufel" }),
    );
  });

  it("POST /api/v1/kunden takes a short name another operator has", async () => {
    const body = { ...daten("Auch Teufel"), kuerzel: "kunde-von-teufel" };
    expect(await partner.json("/api/v1/kunden", { body })).toMatchObject({
      status: 201,
      daten: { kuerzel: "kunde-von-teufel" },
    });
    unveraendert();
  });

  it("PUT /api/v1/kunden/:kundeId/kuendigung does not end another's contract", async () => {
    const antwort = await partner.json(`/api/v1/kunden/${fremdId}/kuendigung`, {
      method: "PUT",
      body: { ende: BEGINN + TAG, grund: "fremd" },
    });
    expect(antwort.status).toBe(404);
    unveraendert();
  });

  it("DELETE /api/v1/kunden/:kundeId/kuendigung does not touch another's contract", async () => {
    const pfad = `/api/v1/kunden/${fremdId}/kuendigung`;
    await teufel.json(pfad, { method: "PUT", body: { ende: BEGINN + TAG, grund: "gekündigt" } });
    const antwort = await partner.json(pfad, { method: "DELETE", body: { grund: "fremd" } });
    expect(antwort.status).toBe(404);
    expect(server.db.select().from(vertraege).all()).toContainEqual(
      expect.objectContaining({ kundeId: fremdId, ende: BEGINN + TAG }),
    );
    await teufel.json(pfad, { method: "DELETE", body: { grund: "zurück" } });
    unveraendert();
  });
});

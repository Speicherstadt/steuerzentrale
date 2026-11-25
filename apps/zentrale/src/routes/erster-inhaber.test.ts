import { describe, expect, it } from "vitest";
import { organization } from "../db/auth-schema.ts";
import { auditLog, betreiber, mitglieder } from "../db/schema.ts";
import { EINRICHTUNG_GUELTIG_MS } from "../modules/anmeldung/einrichtungscode.ts";
import { PASSWORT, testServer } from "../testhilfen/server.ts";
import { betreiberEinrichten } from "./erster-inhaber.ts";

const angaben = (code: string, email = "ines@betreiber.test") => ({
  code,
  betreiber: "Teufel IT",
  name: "Ines Inhaber",
  email,
  passwort: PASSWORT,
});

// BAULISTE.md Z-104: the first owner comes in with the setup code from the log
describe("POST /api/v1/erster-inhaber", () => {
  it("makes the operator, its organization and the owner, all with the same id", async () => {
    const server = testServer();
    const b = server.browser();
    expect((await b.json("/api/v1/erster-inhaber")).daten).toEqual({ offen: true });
    const { status, daten } = await b.json("/api/v1/erster-inhaber", {
      body: angaben(server.neuerCode()),
    });
    expect(status).toBe(201);
    const { betreiberId, nutzerId } = daten as { betreiberId: string; nutzerId: string };
    expect(server.db.select().from(betreiber).all()).toEqual([
      expect.objectContaining({ betreiberId, name: "Teufel IT" }),
    ]);
    expect(server.db.select().from(organization).all()).toEqual([
      expect.objectContaining({ id: betreiberId, name: "Teufel IT" }),
    ]);
    expect(server.db.select().from(mitglieder).all()).toEqual([
      expect.objectContaining({ betreiberId, nutzerId, rolle: "inhaber" }),
    ]);
    expect((await b.json("/api/v1/erster-inhaber")).daten).toEqual({ offen: false });
  });

  it("stands in the audit log with the new owner as actor", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    const eintraege = server.db.select().from(auditLog).all();
    expect(eintraege.map((e) => e.aktion)).toEqual([
      "einrichtungscode.anlegen",
      "einrichtungscode.einloesen",
      "betreiber.anlegen",
      "betreiber.anlegen",
    ]);
    expect(eintraege.every((e) => e.betreiberId === inhaber.betreiberId)).toBe(true);
    expect(eintraege.slice(2).every((e) => e.akteur === inhaber.nutzerId)).toBe(true);
  });

  it("signs the owner in, for the setup of the second factor", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    expect((await inhaber.anfrage("/api/v1/einrichtung")).status).toBe(200);
  });

  it("refuses the code a second time", async () => {
    const server = testServer();
    const code = server.neuerCode();
    expect(
      (await server.browser().json("/api/v1/erster-inhaber", { body: angaben(code) })).status,
    ).toBe(201);
    const zweiter = await server.browser().json("/api/v1/erster-inhaber", {
      body: angaben(code, "zweite@betreiber.test"),
    });
    expect(zweiter.status).toBe(409);
    expect(zweiter.daten).toEqual({ fehler: "abgeschlossen" });
  });

  it("refuses a used code even while the setup is open", async () => {
    const server = testServer();
    const code = server.neuerCode();
    // the code is used up, the account then fails (here: removed operator and membership): the code
    // stays gone
    expect(
      (await server.browser().json("/api/v1/erster-inhaber", { body: angaben(code) })).status,
    ).toBe(201);
    server.sqlite.run("PRAGMA foreign_keys = OFF");
    server.sqlite.run("DELETE FROM mitglieder");
    server.sqlite.run("DELETE FROM betreiber");
    const nochmal = await server.browser().json("/api/v1/erster-inhaber", {
      body: angaben(code, "noch@betreiber.test"),
    });
    expect(nochmal).toEqual({ status: 403, daten: { fehler: "code_ungueltig" } });
  });

  // BAULISTE.md Z-1208: the Zentrale has exactly one operator
  it("refuses a second operator, even when the setup is open again", async () => {
    const server = testServer();
    const erster = await server.ersterInhaber();
    server.sqlite.run("DELETE FROM mitglieder");
    const code = server.neuerCode();
    const zweiter = await server.browser().json("/api/v1/erster-inhaber", {
      body: angaben(code, "zweite@betreiber.test"),
    });
    expect(zweiter).toEqual({ status: 409, daten: { fehler: "betreiber_vorhanden" } });
    expect(server.db.select().from(betreiber).all()).toEqual([
      expect.objectContaining({ betreiberId: erster.betreiberId }),
    ]);
    expect(await server.deps.auth.emailVergeben("zweite@betreiber.test")).toBe(false);
  });

  it("refuses a second operator made past the route", async () => {
    const server = testServer();
    await server.ersterInhaber();
    const konto = await betreiberEinrichten(server.deps, "zweiter", {
      betreiber: "Partner GmbH",
      name: "Paula Partner",
      email: "paula@partner.test",
      passwort: PASSWORT,
    });
    expect(konto).toEqual({ ok: false, grund: "betreiber_vorhanden" });
    expect(server.db.select().from(betreiber).all()).toHaveLength(1);
    expect(server.db.select().from(organization).all()).toHaveLength(1);
  });

  it("refuses the code after 24 hours", async () => {
    const server = testServer();
    const code = server.neuerCode();
    server.stelleUhr(server.jetzt() + EINRICHTUNG_GUELTIG_MS);
    const { status, daten } = await server.browser().json("/api/v1/erster-inhaber", {
      body: angaben(code),
    });
    expect(status).toBe(403);
    expect(daten).toEqual({ fehler: "code_ungueltig" });
    expect(server.db.select().from(betreiber).all()).toEqual([]);
  });

  it("refuses a wrong code and keeps the right one", async () => {
    const server = testServer();
    const code = server.neuerCode();
    const falsch = await server.browser().json("/api/v1/erster-inhaber", {
      body: angaben(`${code}x`),
    });
    expect(falsch.status).toBe(403);
    expect(
      (await server.browser().json("/api/v1/erster-inhaber", { body: angaben(code) })).status,
    ).toBe(201);
  });

  it("refuses invalid details without using up the code", async () => {
    const server = testServer();
    const code = server.neuerCode();
    for (const kaputt of [
      { ...angaben(code), email: "keine-adresse" },
      { ...angaben(code), passwort: "kurz" },
      { ...angaben(code), betreiber: "" },
      { ...angaben(code), rolle: "inhaber" },
    ])
      expect((await server.browser().json("/api/v1/erster-inhaber", { body: kaputt })).status).toBe(
        400,
      );
    expect(
      (await server.browser().json("/api/v1/erster-inhaber", { body: angaben(code) })).status,
    ).toBe(201);
  });

  it("never writes the code into the request log", async () => {
    const server = testServer();
    const code = server.neuerCode();
    await server.browser().json("/api/v1/erster-inhaber", { body: angaben(code) });
    expect(server.log.length).toBeGreaterThan(0);
    expect(server.log.join("\n")).not.toContain(code);
  });
});

import { describe, expect, it } from "vitest";
import { member } from "../db/auth-schema.ts";
import { auditLog, einladungen, mitglieder, tokens } from "../db/schema.ts";
import { EINLADUNG_GUELTIG_MS } from "../modules/mitglieder/index.ts";
import { PASSWORT, TEST_URL, type TestServer, testServer } from "../testhilfen/server.ts";

type Inhaber = Awaited<ReturnType<TestServer["inhaber"]>>;

const einladen = async (inhaber: Inhaber, rolle = "technik") => {
  const { status, daten } = await inhaber.json("/api/v1/einladungen", { body: { rolle } });
  if (status !== 201) throw new Error(`einladen ${status}`);
  const antwort = daten as { einladungId: string; link: string; gueltigBis: number };
  return { ...antwort, token: antwort.link.split("#")[1] ?? "" };
};

const konto = (token: string, email = "tom@betreiber.test") => ({
  token,
  name: "Tom Technik",
  email,
  passwort: PASSWORT,
});

// BAULISTE.md Z-104: invitations by link, the token only as a hash, with an expiry
describe("an invitation", () => {
  it("is a link with the token after the #, valid for seven days, stored only as a hash", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { link, token, gueltigBis } = await einladen(inhaber);
    expect(link.startsWith(`${TEST_URL}/einladung#`)).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(gueltigBis).toBe(server.jetzt() + EINLADUNG_GUELTIG_MS);
    const gespeichert = JSON.stringify([
      server.db.select().from(tokens).all(),
      server.db.select().from(einladungen).all(),
      server.db.select().from(auditLog).all(),
    ]);
    expect(gespeichert).not.toContain(token);
  });

  it("tells what it is for, and is accepted with a new account in its role", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token } = await einladen(inhaber, "support");
    const neu = server.browser();
    expect((await neu.json("/api/v1/einladung/ansehen", { body: { token } })).daten).toMatchObject({
      betreiber: "Teufel IT",
      rolle: "support",
    });
    const { status, daten } = await neu.json("/api/v1/einladung/annehmen", { body: konto(token) });
    expect(status).toBe(201);
    const { nutzerId } = daten as { nutzerId: string };
    expect(server.db.select().from(mitglieder).all()).toContainEqual(
      expect.objectContaining({ betreiberId: inhaber.betreiberId, nutzerId, rolle: "support" }),
    );
    expect(server.db.select().from(member).all()).toContainEqual(
      expect.objectContaining({
        organizationId: inhaber.betreiberId,
        userId: nutzerId,
        role: "support",
      }),
    );
    // signed in, but first the second factor
    expect((await neu.json("/api/v1/ich")).daten).toEqual({ fehler: "zweiter_faktor_fehlt" });
    await server.totpEinrichten(neu);
    expect((await neu.json("/api/v1/ich")).daten).toMatchObject({ rolle: "support", nutzerId });
  });

  it("stands in the audit log: made by the owner, accepted by the new member", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token, einladungId } = await einladen(inhaber);
    const { daten } = await server
      .browser()
      .json("/api/v1/einladung/annehmen", { body: konto(token) });
    const { nutzerId } = daten as { nutzerId: string };
    const eintraege = server.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.ziel.includes(einladungId) || e.ziel.includes(nutzerId));
    expect(eintraege.map((e) => [e.aktion, e.akteur])).toEqual([
      ["einladung.anlegen", inhaber.nutzerId],
      ["einladung.anlegen", inhaber.nutzerId],
      ["einladung.einloesen", "einladung"],
      ["einladung.annehmen", nutzerId],
      ["einladung.annehmen", nutzerId],
    ]);
  });

  it("is accepted once", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token } = await einladen(inhaber);
    expect(
      (await server.browser().json("/api/v1/einladung/annehmen", { body: konto(token) })).status,
    ).toBe(201);
    const nochmal = await server.browser().json("/api/v1/einladung/annehmen", {
      body: konto(token, "zweiter@betreiber.test"),
    });
    expect(nochmal).toEqual({ status: 404, daten: { fehler: "einladung_ungueltig" } });
    expect(
      (await server.browser().json("/api/v1/einladung/ansehen", { body: { token } })).status,
    ).toBe(404);
  });

  it("is refused after seven days", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token } = await einladen(inhaber);
    server.stelleUhr(server.jetzt() + EINLADUNG_GUELTIG_MS);
    const { status } = await server
      .browser()
      .json("/api/v1/einladung/annehmen", { body: konto(token) });
    expect(status).toBe(404);
    const liste = await inhaber.json("/api/v1/einladungen");
    expect(liste.daten).toMatchObject({ einladungen: [{ abgelaufen: true }] });
  });

  it("can be withdrawn while open, and is refused afterwards", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token, einladungId } = await einladen(inhaber);
    expect((await inhaber.json("/api/v1/einladungen")).daten).toMatchObject({
      einladungen: [{ einladungId, rolle: "technik", abgelaufen: false }],
    });
    const weg = await inhaber.anfrage(`/api/v1/einladungen/${einladungId}`, { method: "DELETE" });
    expect(weg.status).toBe(204);
    expect((await inhaber.json("/api/v1/einladungen")).daten).toEqual({ einladungen: [] });
    expect(
      (await server.browser().json("/api/v1/einladung/annehmen", { body: konto(token) })).status,
    ).toBe(404);
    expect(
      (await inhaber.anfrage(`/api/v1/einladungen/${einladungId}`, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("keeps an accepted invitation as a record that cannot be withdrawn", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token, einladungId } = await einladen(inhaber);
    await server.browser().json("/api/v1/einladung/annehmen", { body: konto(token) });
    expect((await inhaber.json("/api/v1/einladungen")).daten).toEqual({ einladungen: [] });
    expect(
      (await inhaber.anfrage(`/api/v1/einladungen/${einladungId}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect(server.db.select().from(einladungen).all()).toEqual([
      expect.objectContaining({ einladungId, angenommenAm: server.jetzt() }),
    ]);
  });

  it("refuses an address that has an account, without using up the link", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token } = await einladen(inhaber);
    const vergeben = await server.browser().json("/api/v1/einladung/annehmen", {
      body: konto(token, inhaber.email),
    });
    expect(vergeben).toEqual({ status: 409, daten: { fehler: "email_vergeben" } });
    expect(
      (await server.browser().json("/api/v1/einladung/annehmen", { body: konto(token) })).status,
    ).toBe(201);
  });

  it("refuses unknown roles and bad details", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    for (const rolle of ["owner", "admin", "", "inhaber,technik"])
      expect((await inhaber.json("/api/v1/einladungen", { body: { rolle } })).status, rolle).toBe(
        400,
      );
    const { token } = await einladen(inhaber);
    for (const kaputt of [
      { ...konto(token), passwort: "kurz" },
      { ...konto(token), email: "x" },
      { token },
    ])
      expect(
        (await server.browser().json("/api/v1/einladung/annehmen", { body: kaputt })).status,
      ).toBe(400);
  });

  it("never puts the token into the request log", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const { token } = await einladen(inhaber);
    await server.browser().json("/api/v1/einladung/ansehen", { body: { token } });
    await server.browser().json("/api/v1/einladung/annehmen", { body: konto(token) });
    expect(server.log.join("\n")).not.toContain(token);
  });
});

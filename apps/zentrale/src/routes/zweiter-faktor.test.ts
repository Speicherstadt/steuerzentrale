import { describe, expect, it } from "vitest";
import { PASSWORT, testServer } from "../testhilfen/server.ts";
import { totpCode } from "../testhilfen/totp.ts";
import { ROUTEN, type RoutenName } from "./zugang.ts";

/** A request for every route that needs a role, with its parameters filled in */
const mitRecht = (Object.keys(ROUTEN) as RoutenName[]).filter(
  (name) => ROUTEN[name].art === "recht",
);
const anfrageFuer = (name: RoutenName) => {
  const [methode = "GET", pfad = ""] = name.split(" ");
  return { methode, pfad: pfad.replace(/:\w+/g, "x") };
};

// BAULISTE.md Z-104: an account without its second factor reaches nothing but its setup
describe("an account without a second factor", () => {
  it("reaches the setup and learns what is missing", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    const { status, daten } = await inhaber.json("/api/v1/einrichtung");
    expect(status).toBe(200);
    expect(daten).toEqual({ passwort: true, totp: false, passkeys: 0, zweiterFaktor: false });
  });

  it("reaches no route that needs a role", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    expect(mitRecht.length).toBeGreaterThan(3);
    for (const name of mitRecht) {
      const { methode, pfad } = anfrageFuer(name);
      const { status, daten } = await inhaber.json(pfad, {
        method: methode,
        ...(methode === "GET" || methode === "DELETE" ? {} : { body: { rolle: "technik" } }),
      });
      expect([status, daten], name).toEqual([403, { fehler: "zweiter_faktor_fehlt" }]);
    }
  });

  it("reaches no closed route of Better Auth", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    for (const [methode, pfad] of [
      ["GET", "/api/auth/organization/list-members"],
      ["POST", "/api/auth/organization/invite-member"],
      ["POST", "/api/auth/organization/update-member-role"],
      ["POST", "/api/auth/two-factor/disable"],
      ["POST", "/api/auth/sign-up/email"],
      ["POST", "/api/auth/change-password"],
      ["POST", "/api/auth/update-user"],
    ] as const)
      expect((await inhaber.anfrage(pfad, { method: methode, body: {} })).status, pfad).toBe(404);
  });

  it("with a password, gets on with TOTP", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    await server.totpEinrichten(inhaber);
    expect((await inhaber.anfrage("/api/v1/ich")).status).toBe(200);
  });

  it("with a password, does not get on with a passkey alone", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    await server.passkeyEinrichten(inhaber);
    expect((await inhaber.json("/api/v1/ich")).daten).toEqual({ fehler: "zweiter_faktor_fehlt" });
  });

  it("without a password, gets on with a passkey", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber({ passwort: null });
    expect((await inhaber.json("/api/v1/ich")).status).toBe(403);
    await server.passkeyEinrichten(inhaber);
    const { status, daten } = await inhaber.json("/api/v1/ich");
    expect(status).toBe(200);
    expect(daten).toMatchObject({ rolle: "inhaber", betreiber: { name: "Teufel IT" } });
  });

  it("signing in again with the password alone, still reaches only the setup", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    const neu = server.browser();
    const an = await neu.anfrage("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: PASSWORT },
    });
    expect(an.status).toBe(200);
    expect((await neu.json("/api/v1/ich")).daten).toEqual({ fehler: "zweiter_faktor_fehlt" });
    expect((await neu.anfrage("/api/v1/einrichtung")).status).toBe(200);
  });

  it("a session signed in with the password alone does not get on once TOTP is set up elsewhere", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber();
    const frueher = server.browser();
    await frueher.anfrage("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: PASSWORT },
    });
    expect((await frueher.json("/api/v1/ich")).status).toBe(403);
    const schluessel = await server.totpEinrichten(inhaber);
    expect((await inhaber.anfrage("/api/v1/ich")).status).toBe(200);
    expect((await frueher.anfrage("/api/v1/ich")).status).not.toBe(200);
    // a later sign-in with password and code ends no other session
    const spaeter = server.browser();
    await spaeter.anfrage("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: PASSWORT },
    });
    await spaeter.anfrage("/api/auth/two-factor/verify-totp", {
      body: { code: totpCode(schluessel) },
    });
    expect((await spaeter.anfrage("/api/v1/ich")).status).toBe(200);
    expect((await inhaber.anfrage("/api/v1/ich")).status).toBe(200);
  });

  it("without a session, gets 401 everywhere but the public routes", async () => {
    const server = testServer();
    const fremd = server.browser();
    for (const name of [...mitRecht, "GET /api/v1/einrichtung" as const]) {
      const { methode, pfad } = anfrageFuer(name);
      const { status } = await fremd.json(pfad, {
        method: methode,
        ...(methode === "GET" || methode === "DELETE" ? {} : { body: {} }),
      });
      expect(status, name).toBe(401);
    }
  });
});

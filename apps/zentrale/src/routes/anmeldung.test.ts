import { describe, expect, it } from "vitest";
import { authenticator } from "../testhilfen/authenticator.ts";
import { PASSWORT, TEST_URL, testServer } from "../testhilfen/server.ts";
import { totpCode } from "../testhilfen/totp.ts";

// BAULISTE.md Z-104: sign-in with a passkey, and with password and TOTP, on the API
describe("sign-in with a passkey", () => {
  it("is enough for an account without a password", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber({ passwort: null });
    const geraet = await server.passkeyEinrichten(inhaber);
    const neu = server.browser();
    const optionen = await neu.json("/api/auth/passkey/generate-authenticate-options");
    expect(optionen.status).toBe(200);
    const an = await neu.anfrage("/api/auth/passkey/verify-authentication", {
      body: { response: geraet.anmelden(optionen.daten) },
    });
    expect(an.status).toBe(200);
    const { status, daten } = await neu.json("/api/v1/ich");
    expect(status).toBe(200);
    expect(daten).toMatchObject({ email: inhaber.email, rolle: "inhaber", faktor: "passkey" });
  });

  it("refuses a passkey that was never registered", async () => {
    const server = testServer();
    const inhaber = await server.ersterInhaber({ passwort: null });
    await server.passkeyEinrichten(inhaber);
    const fremdesGeraet = authenticator(TEST_URL);
    const neu = server.browser();
    const optionen = await neu.json("/api/auth/passkey/generate-authenticate-options");
    const an = await neu.anfrage("/api/auth/passkey/verify-authentication", {
      body: { response: fremdesGeraet.anmelden(optionen.daten) },
    });
    expect(an.status).toBeGreaterThanOrEqual(400);
    expect((await neu.anfrage("/api/v1/ich")).status).toBe(401);
  });
});

describe("sign-in with password and TOTP", () => {
  it("asks for the code after the password and lets in only with it", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const neu = server.browser();
    const an = await neu.json("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: PASSWORT },
    });
    expect(an.status).toBe(200);
    expect(an.daten).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    // the password alone gives no session
    expect((await neu.anfrage("/api/v1/einrichtung")).status).toBe(401);
    const code = await neu.anfrage("/api/auth/two-factor/verify-totp", {
      body: { code: totpCode(inhaber.totp) },
    });
    expect(code.status).toBe(200);
    expect((await neu.json("/api/v1/ich")).daten).toMatchObject({
      rolle: "inhaber",
      faktor: "totp",
    });
  });

  it("refuses a wrong code", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const neu = server.browser();
    await neu.anfrage("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: PASSWORT },
    });
    const richtig = totpCode(inhaber.totp);
    const falsch = String((Number(richtig) + 1) % 1_000_000).padStart(6, "0");
    expect(
      (await neu.anfrage("/api/auth/two-factor/verify-totp", { body: { code: falsch } })).status,
    ).toBe(401);
    expect((await neu.anfrage("/api/v1/ich")).status).toBe(401);
  });

  it("refuses a wrong password", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const neu = server.browser();
    const an = await neu.anfrage("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: "falsch-falsch-falsch" },
    });
    expect(an.status).toBe(401);
  });

  it("never trusts a device, which would skip TOTP next time", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const neu = server.browser();
    await neu.anfrage("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: PASSWORT },
    });
    const vertrauen = await neu.anfrage("/api/auth/two-factor/verify-totp", {
      body: { code: totpCode(inhaber.totp), trustDevice: true },
    });
    expect(vertrauen.status).toBe(400);
    expect((await neu.anfrage("/api/v1/ich")).status).toBe(401);
  });
});

describe("the sign-in's rate limit", () => {
  const anmelden = (b: ReturnType<ReturnType<typeof testServer>["browser"]>, email: string) =>
    b.anfrage("/api/auth/sign-in/email", { body: { email, password: "falsch-falsch-falsch" } });

  it("stops a sixth attempt within a minute from one address", async () => {
    const server = testServer();
    const angreifer = server.browser();
    const status: number[] = [];
    for (let i = 0; i < 6; i++) status.push((await anmelden(angreifer, "a@b.test")).status);
    expect(status.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(status[5]).toBe(429);
  });

  it("is not escaped by an X-Forwarded-For or address header a client sends", async () => {
    const server = testServer();
    const angreifer = server.browser();
    const status: number[] = [];
    for (let i = 0; i < 8; i++)
      status.push(
        (
          await angreifer.anfrage("/api/auth/sign-in/email", {
            body: { email: "a@b.test", password: "falsch-falsch-falsch" },
            headers: {
              "x-forwarded-for": `203.0.113.${i}`,
              "x-steuerzentrale-client": `203.0.113.${i}`,
            },
          })
        ).status,
      );
    expect(status).toContain(429);
  });

  it("counts each address on its own: one client does not lock out another", async () => {
    const server = testServer();
    const inhaber = await server.inhaber();
    const angreifer = server.browser();
    for (let i = 0; i < 6; i++) await anmelden(angreifer, inhaber.email);
    const echt = server.browser();
    const an = await echt.json("/api/auth/sign-in/email", {
      body: { email: inhaber.email, password: PASSWORT },
    });
    expect(an.status).toBe(200);
  });

  it("believes the Pforte's X-Forwarded-For on the loopback address", async () => {
    const server = testServer();
    const pforte = server.browser("127.0.0.1");
    const status = async (client: string) =>
      (
        await pforte.anfrage("/api/auth/sign-in/email", {
          body: { email: "a@b.test", password: "falsch-falsch-falsch" },
          headers: { "x-forwarded-for": client },
        })
      ).status;
    for (let i = 0; i < 5; i++) await status("192.0.2.10");
    expect(await status("192.0.2.10")).toBe(429);
    expect(await status("192.0.2.11")).toBe(401);
  });

  it("also limits the TOTP code", async () => {
    const server = testServer();
    const neu = server.browser();
    const status: number[] = [];
    for (let i = 0; i < 6; i++)
      status.push(
        (await neu.anfrage("/api/auth/two-factor/verify-totp", { body: { code: "000000" } }))
          .status,
      );
    expect(status).toContain(429);
  });
});

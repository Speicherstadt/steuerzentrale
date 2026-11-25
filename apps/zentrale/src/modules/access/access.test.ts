import { describe, expect, it } from "vitest";
import { accessPruefen, accessSchluessel, certsUrl, teamGueltig } from "./index.ts";
import { AUD, certsAntwort, ISS, paarErzeugen, TEAM, tokenSignieren } from "./testhilfen.ts";

/*
 * BAULISTE.md Z-1104: a token of Cloudflare Access is valid only with a signature of the team's keys
 * (RS256), our audience, the team's issuer, not expired and not before its time (Cloudflare docs,
 * "Validate JWTs": cloudflare/cloudflare-docs, access-controls/applications/http-apps/
 * authorization-cookie/validating-json.mdx). The keys come only from
 * https://<team>.cloudflareaccess.com/cdn-cgi/access/certs and are loaded again once for a key id
 * they do not know (Access rotates its key every 6 weeks).
 */

const JETZT = Date.UTC(2026, 10, 25, 12);

const umgebung = async () => {
  const a = await paarErzeugen("kid-a");
  const fremd = await paarErzeugen("kid-a");
  const gefragt: string[] = [];
  let liste = [a];
  const uhr = { ms: JETZT };
  const schluessel = accessSchluessel({
    team: TEAM,
    jetzt: () => uhr.ms,
    holen: async (url) => {
      gefragt.push(url);
      return Response.json(await certsAntwort(...liste));
    },
  });
  const pruefen = (token: string | null) =>
    accessPruefen(token, { team: TEAM, aud: AUD, jetzt: uhr.ms, schluessel });
  return {
    a,
    fremd,
    gefragt,
    uhr,
    pruefen,
    setzen: (neu: typeof liste) => {
      liste = neu;
    },
  };
};

describe("a token of Cloudflare Access", () => {
  it("is valid with the team's signature, our audience and issuer, in its time", async () => {
    const u = await umgebung();
    expect(await u.pruefen(await tokenSignieren(u.a, JETZT))).toEqual({
      ok: true,
      email: "tristan@teufel-it.de",
    });
    // aud as a string, as JWT allows
    expect(await u.pruefen(await tokenSignieren(u.a, JETZT, { aud: AUD }))).toMatchObject({
      ok: true,
    });
  });

  it.each([
    ["no token", async () => null, "kein_token"],
    ["no JWT", async () => "abc.def", "form"],
    ["garbage parts", async () => "a.b.c", "form"],
  ])("refuses %s", async (_, token, grund) => {
    const u = await umgebung();
    expect(await u.pruefen(await token())).toEqual({ ok: false, grund });
  });

  it("refuses a signature of another key, even with the right key id", async () => {
    const u = await umgebung();
    expect(await u.pruefen(await tokenSignieren(u.fremd, JETZT))).toEqual({
      ok: false,
      grund: "signatur",
    });
  });

  it("refuses a changed payload under a valid signature", async () => {
    const u = await umgebung();
    const [h, , s] = (await tokenSignieren(u.a, JETZT)).split(".");
    const anders = Buffer.from(JSON.stringify({ aud: [AUD], iss: ISS, exp: 9e9 })).toString(
      "base64url",
    );
    expect(await u.pruefen(`${h}.${anders}.${s}`)).toEqual({ ok: false, grund: "signatur" });
  });

  it.each([
    ["another audience", { aud: ["0".repeat(64)] }, "aud"],
    ["no audience", { aud: undefined }, "aud"],
    ["another issuer", { iss: "https://boese.cloudflareaccess.com" }, "iss"],
    ["an expired one", { exp: Math.floor(JETZT / 1000) - 1 }, "abgelaufen"],
    ["one without expiry", { exp: undefined }, "abgelaufen"],
    ["one not yet valid", { nbf: Math.floor(JETZT / 1000) + 30 }, "noch_nicht"],
  ])("refuses %s", async (_, claims, grund) => {
    const u = await umgebung();
    expect(await u.pruefen(await tokenSignieren(u.a, JETZT, claims))).toEqual({
      ok: false,
      grund,
    });
  });

  it.each([
    ["alg none", { alg: "none" }],
    ["alg HS256", { alg: "HS256" }],
    ["no key id", { kid: undefined }],
  ])("refuses %s in the header", async (_, kopf) => {
    const u = await umgebung();
    expect((await u.pruefen(await tokenSignieren(u.a, JETZT, {}, kopf))).ok).toBe(false);
  });
});

describe("the team's keys", () => {
  it("come only from https://<team>.cloudflareaccess.com/cdn-cgi/access/certs", async () => {
    const u = await umgebung();
    await u.pruefen(await tokenSignieren(u.a, JETZT, { iss: "https://boese.example" }));
    expect(u.gefragt).toEqual(["https://teufel.cloudflareaccess.com/cdn-cgi/access/certs"]);
    expect(certsUrl("teufel")).toBe("https://teufel.cloudflareaccess.com/cdn-cgi/access/certs");
  });

  it("take a team name only as a single DNS label", () => {
    expect(teamGueltig("teufel-it")).toBe(true);
    for (const falsch of [
      "",
      "a.b",
      "boese.example/x",
      "-a",
      "a-",
      "A",
      "a b",
      "a@b",
      "a".repeat(64),
    ])
      expect(teamGueltig(falsch), falsch).toBe(false);
  });

  it("are loaded once and kept, and once more for a key id they do not know", async () => {
    const u = await umgebung();
    const b = await paarErzeugen("kid-b");
    expect((await u.pruefen(await tokenSignieren(u.a, JETZT))).ok).toBe(true);
    expect((await u.pruefen(await tokenSignieren(u.a, JETZT))).ok).toBe(true);
    expect(u.gefragt).toHaveLength(1);
    // Access rotated its key: the new key id is loaded once
    u.setzen([u.a, b]);
    u.uhr.ms += 61_000;
    expect((await u.pruefen(await tokenSignieren(b, u.uhr.ms))).ok).toBe(true);
    expect(u.gefragt).toHaveLength(2);
  });

  it("are not loaded again for every unknown key id: once a minute at most", async () => {
    const u = await umgebung();
    expect((await u.pruefen(await tokenSignieren(u.a, JETZT))).ok).toBe(true);
    u.uhr.ms += 61_000;
    const x = await paarErzeugen("kid-x");
    expect(await u.pruefen(await tokenSignieren(x, u.uhr.ms))).toEqual({
      ok: false,
      grund: "schluessel",
    });
    expect(u.gefragt).toHaveLength(2);
    for (const kid of ["kid-y", "kid-z"])
      await u.pruefen(await tokenSignieren(await paarErzeugen(kid), u.uhr.ms));
    expect(u.gefragt).toHaveLength(2);
  });

  it("are loaded once for requests that come at the same time", async () => {
    const u = await umgebung();
    const token = await tokenSignieren(u.a, JETZT);
    const r = await Promise.all([u.pruefen(token), u.pruefen(token), u.pruefen(token)]);
    expect(r.map((x) => x.ok)).toEqual([true, true, true]);
    expect(u.gefragt).toHaveLength(1);
  });

  it("refuse every token while they cannot be loaded", async () => {
    const a = await paarErzeugen("kid-a");
    const schluessel = accessSchluessel({
      team: TEAM,
      jetzt: () => JETZT,
      holen: async () => new Response("kaputt", { status: 502 }),
    });
    expect(
      await accessPruefen(await tokenSignieren(a, JETZT), {
        team: TEAM,
        aud: AUD,
        jetzt: JETZT,
        schluessel,
      }),
    ).toEqual({ ok: false, grund: "schluessel" });
  });
});

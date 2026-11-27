import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pforteTls } from "../../testhilfen/tls.ts";
import { type Aufloeser, dnsFragen, type SondenDeps, sonde } from "./sonde.ts";

/*
 * BAULISTE.md Z-704: the steps of the check from outside on a real TLS connection, against a
 * Pforte stand-in on 127.0.0.1 with a certificate of a test CA for `localhost`; the resolver is a
 * fake, so no test asks a real name server (AGENTS.md, "Nie": no real servers in tests).
 */

const lokal: Aufloeser = {
  resolve4: async () => ["127.0.0.1"],
  resolve6: async () => {
    throw Object.assign(new Error("no data"), { code: "ENODATA" });
  },
};
const ZEIT = { dns: 1_000, tls: 2_000, http: 2_000 };

let pforte: Server<unknown>;
let tls: Awaited<ReturnType<typeof pforteTls>>;
let abgelaufen: Server<unknown>;

beforeAll(async () => {
  tls = await pforteTls();
  pforte = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: tls.zertifikat, key: tls.schluessel },
    fetch: (r) => {
      const pfad = new URL(r.url).pathname;
      if (pfad === "/health") return new Response("ok");
      if (pfad === "/weiter") return Response.redirect("https://example.org/", 302);
      return new Response("weg", { status: 503 });
    },
  });
  // a certificate that ended two days ago
  const alt = await pforteTls(Date.now() - 3 * 86_400_000);
  abgelaufen = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: alt.zertifikat, key: alt.schluessel },
    fetch: () => new Response("ok"),
  });
});

afterAll(() => {
  pforte.stop(true);
  abgelaufen.stop(true);
});

// The stand-ins listen on loopback, which the Zentrale itself never connects to
const deps = (teil: Partial<SondenDeps> = {}): SondenDeps => ({
  aufloeser: lokal,
  port: pforte.port ?? 0,
  ca: tls.ca,
  zeitlimitMs: ZEIT,
  adresseErlaubt: () => true,
  ...teil,
});

const zeigtAuf = (...ips: string[]): Aufloeser => ({
  resolve4: async () => ips.filter((ip) => !ip.includes(":")),
  resolve6: async () => ips.filter((ip) => ip.includes(":")),
});

describe("sonde, addresses that are not public", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])(
    "connects to none: %s (a host the operator enters must not reach the Zentrale's own network)",
    async (ip) => {
      const { adresseErlaubt: _, ...ohne } = deps({ aufloeser: zeigtAuf(ip) });
      const p = await sonde(ohne)("localhost", "/health");
      expect(p.tls).toBeUndefined();
      expect(p.http).toBeUndefined();
      expect(p.dns).toEqual({ ok: false, fehler: `keine öffentliche Adresse: ${ip}` });
    },
  );

  it("connects to none when only one of the addresses is not public", async () => {
    const { adresseErlaubt: _, ...ohne } = deps({
      aufloeser: zeigtAuf("203.0.113.10", "10.0.0.1"),
    });
    expect(await sonde(ohne)("localhost", "/health")).toEqual({
      dns: { ok: false, fehler: "keine öffentliche Adresse: 10.0.0.1" },
    });
  });
});

describe("sonde, one address for every step", () => {
  let zweite: Server<unknown>;
  beforeAll(() => {
    zweite = Bun.serve({
      port: 0,
      hostname: "127.0.0.2",
      tls: { cert: tls.zertifikat, key: tls.schluessel },
      fetch: () => new Response("ok"),
    });
  });
  afterAll(() => zweite.stop(true));

  it("sends the request to the address it resolved and checked, not to one the system resolves again", async () => {
    const p = await sonde(deps({ aufloeser: zeigtAuf("127.0.0.2"), port: zweite.port ?? 0 }))(
      "localhost",
      "/health",
    );
    expect(p.tls).toMatchObject({ ok: true });
    expect(p.http).toMatchObject({ ok: true, status: 200 });
  });
});

describe("sonde", () => {
  it("resolves, connects with TLS to the address and GETs the path through the host", async () => {
    const p = await sonde(deps())("localhost", "/health");
    expect(p.dns).toEqual({ ok: true, a: ["127.0.0.1"], aaaa: [] });
    expect(p.tls).toMatchObject({ ok: true });
    expect(p.tls?.ok && p.tls.gueltigBis).toBeGreaterThan(Date.now());
    expect(p.http).toMatchObject({ ok: true, status: 200 });
  });

  it("reports a status that is not fine as it is, and does not follow a redirect", async () => {
    expect((await sonde(deps())("localhost", "/kaputt")).http).toMatchObject({ status: 503 });
    expect((await sonde(deps())("localhost", "/weiter")).http).toMatchObject({ status: 302 });
  });

  it("tells a certificate it does not trust or that expired from no connection", async () => {
    const fremd = await sonde(deps({ ca: (await pforteTls()).ca }))("localhost", "/health");
    expect(fremd.tls).toMatchObject({ ok: false, art: "zertifikat" });
    expect(fremd.http).toBeUndefined();
    const alt = await sonde(deps({ port: abgelaufen.port ?? 0 }))("localhost", "/health");
    expect(alt.tls).toEqual({ ok: false, art: "zertifikat", fehler: "CERT_HAS_EXPIRED" });
    const name = await sonde(deps())("anders.example", "/health");
    expect(name.tls).toMatchObject({ ok: false, art: "zertifikat" });
    const zu = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } });
    const frei = zu.port;
    zu.stop(true);
    const keine = await sonde(deps({ port: frei }))("localhost", "/health");
    expect(keine.tls).toMatchObject({ ok: false, art: "netz" });
  });

  it("stops after a name that does not resolve", async () => {
    const nichts: Aufloeser = {
      resolve4: () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
      resolve6: () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
    };
    expect(await sonde(deps({ aufloeser: nichts }))("localhost", "/health")).toEqual({
      dns: { ok: false, fehler: "ENOTFOUND" },
    });
  });
});

describe("dnsFragen", () => {
  it("takes a name without records of a type as none of it, and none at all as a failure", async () => {
    const ohne = { resolve4: lokal.resolve6, resolve6: lokal.resolve6 };
    expect(await dnsFragen(ohne, "x.example", 1_000)).toEqual({
      ok: false,
      fehler: "keine A- und AAAA-Einträge",
    });
  });

  it("gives up after its time limit", async () => {
    const haengt = { resolve4: () => new Promise<string[]>(() => {}), resolve6: lokal.resolve4 };
    expect(await dnsFragen(haengt, "x.example", 20)).toEqual({ ok: false, fehler: "Zeitlimit" });
  });
});

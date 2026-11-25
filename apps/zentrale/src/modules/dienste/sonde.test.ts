import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatenbank } from "../../db/test-db.ts";
import { betreiberAnlegen } from "../../testhilfen/bewertung.ts";
import { pforteTls } from "../../testhilfen/tls.ts";
import { aussenPruefen } from "../aussen/pruefen.ts";
import { type Aufloeser, type SondenDeps, sonde } from "../aussen/sonde.ts";
import { dienstAnlegen, dienstLesen } from "./dienste.ts";

/*
 * BAULISTE.md Z-1101 on a real TLS connection: an observed service turns green against a test
 * server with a certificate of a test CA; a name that resolves to an address that is not public is
 * never asked, however the test server would answer. The resolver is a fake (CLAUDE.md, "Never":
 * no real servers in tests).
 */

const HOST = "wiki.teufel-it.test";

const lokal: Aufloeser = {
  resolve4: async () => ["127.0.0.1"],
  resolve6: async () => {
    throw Object.assign(new Error("no data"), { code: "ENODATA" });
  },
};

let dienst: Server<unknown>;
let tls: Awaited<ReturnType<typeof pforteTls>>;
const anfragen: string[] = [];

beforeAll(async () => {
  tls = await pforteTls(Date.now(), [], [HOST]);
  dienst = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: tls.zertifikat, key: tls.schluessel },
    fetch: (r) => {
      anfragen.push(new URL(r.url).pathname);
      return new Response("ok");
    },
  });
});

afterAll(() => {
  dienst.stop(true);
});

const pruefen = async (teil: Partial<SondenDeps>) => {
  const offen = testDatenbank();
  betreiberAnlegen(offen.schreibDb, "b1", []);
  const jetzt = Date.UTC(2026, 10, 23, 12);
  const kontext = { betreiberId: "b1", akteur: "nutzer-1", jetzt, grund: "Dienst angelegt" };
  const r = dienstAnlegen(offen.db, offen.schreibDb, kontext, {
    name: "Wiki",
    host: HOST,
    pfad: "/health",
    kundeId: null,
    innen: null,
  });
  if (!r.ok) throw new Error(r.grund);
  await aussenPruefen({
    db: offen.db,
    schreibDb: offen.schreibDb,
    now: () => jetzt,
    log: () => {},
    sonde: sonde({
      aufloeser: lokal,
      port: dienst.port ?? 0,
      ca: tls.ca,
      zeitlimitMs: { dns: 1_000, tls: 2_000, http: 2_000 },
      ...teil,
    }),
  });
  return dienstLesen(offen.db, "b1", r.dienst.id, jetzt)?.aussen;
};

describe("an observed service on the network", () => {
  it("turns green against the test server", async () => {
    anfragen.length = 0;
    // the test server listens on loopback, which only a test lets the check connect to
    const aussen = await pruefen({ adresseErlaubt: () => true });
    expect(anfragen).toEqual(["/health"]);
    expect(aussen).toMatchObject({
      zustand: "gruen",
      grund: { code: "erreichbar", werte: { status: "200" } },
    });
  });

  it("never asks a name that resolves to an address that is not public", async () => {
    anfragen.length = 0;
    const aussen = await pruefen({});
    expect(anfragen).toEqual([]);
    expect(aussen).toMatchObject({
      zustand: "rot",
      grund: { code: "dns", werte: { fehler: "keine öffentliche Adresse: 127.0.0.1" } },
    });
  });
});

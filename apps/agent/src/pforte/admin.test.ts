import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GRUND_ID,
  type Manifest,
  manifestPruefen,
  PFORTE_AKTIONEN,
  pforteAuftragPruefen,
  pforteGrundkonfiguration,
  UNBEKANNT_ID,
} from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { adminUeberSocket, PFORTE_ADMIN_SOCKET, routeEntfernen, routeSetzen } from "./admin.ts";
import { testCaddy } from "./testcaddy.ts";

/*
 * BAULISTE.md Z-401, the agent's side: an address is added to and removed from the Pforte through
 * Caddy's admin API, idempotently and without a restart; the base configuration is loaded first
 * when Caddy has none (a fresh Pforte). Tried against a stand-in here, against Caddy in CI.
 */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");
const geprueft = manifestPruefen(readFileSync(join(FIXTURES, "auftrag.yml"), "utf8"));
if (!geprueft.ok) throw new Error(geprueft.fehler.join("\n"));
const manifest: Manifest = geprueft.manifest;

const route = (name: string, host: string, port: number) => {
  const r = pforteAuftragPruefen(manifest, {
    aktion: PFORTE_AKTIONEN.setzen,
    installationId: name,
    argumente: { host, port },
  });
  if (!r.ok || r.auftrag.art !== "setzen") throw new Error("route");
  return r.auftrag.route;
};

const grund = pforteGrundkonfiguration();
const signal = new AbortController().signal;

describe("an address in the Pforte", () => {
  it("loads the base configuration into a fresh Caddy, then puts the route in front of the 404", async () => {
    const c = testCaddy();
    expect(await routeSetzen(c.admin, grund, route("a-k1", "a.example", 20001), signal)).toEqual({
      ok: true,
      daten: { route: "a-k1", geaendert: "neu" },
    });
    expect(c.geladen).toEqual([grund]);
    expect(c.routen()).toEqual(["a-k1", UNBEKANNT_ID]);
    await routeSetzen(c.admin, grund, route("b-k1", "b.example", 20002), signal);
    expect(c.routen()).toEqual(["b-k1", "a-k1", UNBEKANNT_ID]);
    expect(c.geladen).toHaveLength(1);
  });

  it("replaces a route of the same installation instead of doubling it", async () => {
    const c = testCaddy();
    await routeSetzen(c.admin, grund, route("a-k1", "a.example", 20001), signal);
    const neu = route("a-k1", "a.example", 20009);
    expect(await routeSetzen(c.admin, grund, neu, signal)).toEqual({
      ok: true,
      daten: { route: "a-k1", geaendert: "ersetzt" },
    });
    expect(c.routen()).toEqual(["a-k1", UNBEKANNT_ID]);
    expect(c.aufrufe.at(-1)).toEqual({ methode: "PATCH", pfad: "/id/a-k1", body: neu });
  });

  it("is removed by its id, and removing it again changes nothing", async () => {
    const c = testCaddy();
    await routeSetzen(c.admin, grund, route("a-k1", "a.example", 20001), signal);
    await routeSetzen(c.admin, grund, route("b-k1", "b.example", 20002), signal);
    expect(await routeEntfernen(c.admin, "b-k1", signal)).toEqual({
      ok: true,
      daten: { route: "b-k1", geaendert: "entfernt" },
    });
    expect(c.routen()).toEqual(["a-k1", UNBEKANNT_ID]);
    expect(await routeEntfernen(c.admin, "b-k1", signal)).toEqual({
      ok: true,
      daten: { route: "b-k1", geaendert: "nichts" },
    });
    expect(c.routen()).toEqual(["a-k1", UNBEKANNT_ID]);
  });

  it("reports what Caddy refused, with its status", async () => {
    const c = testCaddy((m) => (m === "PUT" ? 400 : undefined));
    expect(await routeSetzen(c.admin, grund, route("a-k1", "a.example", 20001), signal)).toEqual({
      ok: false,
      fehler: 'Pforte lehnte ab: PUT /id/sz_grund/routes/0: HTTP 400 {"error":"refused"}',
    });
  });

  it("reports a Pforte that does not answer", async () => {
    const admin = adminUeberSocket(async () => {
      throw new Error("ENOENT: no such file");
    }, "/nicht/da.sock");
    expect(await routeEntfernen(admin, "a-k1", signal)).toEqual({
      ok: false,
      fehler: "Pforte nicht erreichbar: Error: ENOENT: no such file",
    });
  });
});

describe("the admin API over its socket", () => {
  it("sends JSON over the Unix socket to the fetch it was given", async () => {
    const gesehen: { url: string; init: RequestInit & { unix?: string } }[] = [];
    const admin = adminUeberSocket(async (url, init) => {
      gesehen.push({ url, init });
      return new Response("{}", { status: 200 });
    }, PFORTE_ADMIN_SOCKET);
    expect(await admin("PATCH", "/id/a-k1", { a: 1 }, signal)).toEqual({ status: 200, text: "{}" });
    expect(gesehen).toEqual([
      {
        url: "http://localhost/id/a-k1",
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: '{"a":1}',
          signal,
          keepalive: false,
          unix: "/home/sz-pforte/pforte/admin.sock",
        },
      },
    ]);
    await admin("GET", `/id/${GRUND_ID}`, undefined, signal);
    expect(gesehen[1]?.init).toEqual({
      method: "GET",
      headers: {},
      signal,
      keepalive: false,
      unix: PFORTE_ADMIN_SOCKET,
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ereignisse } from "../../db/schema.ts";
import { testDatenbank } from "../../db/test-db.ts";
import { signiert } from "../../testhilfen/installationen.ts";
import { manifesteImportieren, probeVersion } from "../../testhilfen/manifeste.ts";
import { type RegistryNachbau, registryNachbau } from "../../testhilfen/registry.ts";
import { schreiben } from "../audit/index.ts";
import { REGISTRY_FEHLER, versionen } from "./index.ts";
import { tagsAbfragen } from "./registry.ts";
import { appsUebersicht } from "./stand.ts";

/*
 * BAULISTE.md Z-501: the Zentrale asks the registry of each app's newest manifest for its tags
 * (the stand-in, testhilfen/registry.ts: pages and a pull token like ghcr.io); a newer version
 * without manifest shows as "Manifest fehlt", one with a manifest as available; "dringend" stands
 * at the version; a failing registry makes the event `registry_fehler`, once a day per app.
 */

// probe.yml names registry.example.org/probe; the redirect sends every registry to the stand-in
const REPO = "probe";
const MORGEN = Date.UTC(2027, 2, 10, 8);

let registry: RegistryNachbau | undefined;
afterEach(() => registry?.stoppen());

const umgebung = (tags: string[], optionen: { seite?: number; token?: boolean } = {}) => {
  registry = registryNachbau({ repos: { [REPO]: tags }, ...optionen });
  const d = testDatenbank();
  const uhr = { ms: MORGEN };
  for (const betreiberId of ["b1", "b2"])
    schreiben(d.schreibDb, { betreiberId, akteur: "test", jetzt: 1, grund: "Test" }, "test", (w) =>
      w.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: 1 }),
    );
  const log: string[] = [];
  const v = versionen({
    db: d.db,
    schreibDb: d.schreibDb,
    fetch,
    umleitung: registry.url,
    now: () => uhr.ms,
    log: (z) => log.push(z),
  });
  const uebersicht = () => appsUebersicht(d.db, v.stand);
  const meldungen = () =>
    d.db
      .select()
      .from(ereignisse)
      .all()
      .filter((e) => e.art === REGISTRY_FEHLER);
  return { ...d, uhr, v, registry, uebersicht, meldungen, log };
};

describe("asking the registries", () => {
  it("finds a new version and marks its manifest missing until it is imported", async () => {
    const u = umgebung(["1.0.0", "1.1.0", "latest", "v1.2.0", "sha-1234"]);
    manifesteImportieren(u, "b1", MORGEN, signiert("probe"));
    await u.v.abfragen();
    const [app] = u.uebersicht();
    expect(app?.registry).toMatchObject({
      image: "registry.example.org/probe",
      versionen: ["1.2.0", "1.1.0", "1.0.0"],
      fehler: null,
      abgefragtAm: MORGEN,
    });
    expect(app?.versionen.map((v) => [v.version, v.zustand])).toEqual([
      ["1.2.0", "manifest_fehlt"],
      ["1.1.0", "manifest_fehlt"],
      ["1.0.0", "verfuegbar"],
    ]);

    manifesteImportieren(u, "b1", MORGEN, probeVersion("1.2.0"));
    const nachher = u.uebersicht()[0]?.versionen ?? [];
    expect(nachher.map((v) => [v.version, v.zustand, v.dringend])).toEqual([
      ["1.2.0", "verfuegbar", true],
      ["1.0.0", "verfuegbar", false],
    ]);
  });

  it("marks a pre-release as such", async () => {
    const u = umgebung(["1.0.0", "2.0.0-rc.1"]);
    manifesteImportieren(u, "b1", MORGEN, signiert("probe"));
    await u.v.abfragen();
    expect(u.uebersicht()[0]?.versionen[0]).toMatchObject({
      version: "2.0.0-rc.1",
      zustand: "manifest_fehlt",
      vorabversion: true,
    });
  });

  it("reads every page and fetches the pull token the registry asks for", async () => {
    const tags = Array.from({ length: 7 }, (_, i) => `1.${i}.0`);
    const u = umgebung(tags, { seite: 3, token: true });
    manifesteImportieren(u, "b1", MORGEN, signiert("probe"));
    await u.v.abfragen();
    expect(u.v.stand.lesen("probe")?.versionen).toHaveLength(7);
    expect(u.registry.anfragen.filter((a) => a.startsWith("/token"))).toHaveLength(1);
    expect(u.registry.anfragen.filter((a) => a.includes("tags/list"))).toHaveLength(4);
  });

  it("asks the image of the newest manifest", async () => {
    const u = umgebung(["1.0.0"]);
    // probe 2.0.0 names its image in the repository probe2
    manifesteImportieren(u, "b1", MORGEN, signiert("probe"), probeVersion("2.0.0"));
    u.registry.tags("probe2", ["2.0.0", "2.1.0"]);
    await u.v.abfragen();
    expect(u.v.stand.lesen("probe")).toMatchObject({
      image: "registry.example.org/probe2",
      versionen: ["2.1.0", "2.0.0"],
    });
  });
});

describe("a failing registry", () => {
  it("makes the event registry_fehler for every operator, once a day per app", async () => {
    const u = umgebung(["1.0.0"]);
    manifesteImportieren(u, "b1", MORGEN, signiert("probe"));
    u.registry.scheitern(10);
    await u.v.abfragen();
    expect(u.v.stand.lesen("probe")?.fehler).toMatch(/HTTP 500/);
    expect(u.meldungen().map((e) => [e.betreiberId, e.schwere, e.ziel])).toEqual([
      ["b1", "warn", "app:probe"],
      ["b2", "warn", "app:probe"],
    ]);

    u.uhr.ms = MORGEN + 6 * 3_600_000;
    await u.v.abfragen();
    expect(u.meldungen()).toHaveLength(2);

    // the next day in Berlin
    u.uhr.ms = MORGEN + 24 * 3_600_000;
    await u.v.abfragen();
    expect(u.meldungen()).toHaveLength(4);
  });

  it("keeps the imported versions available", async () => {
    const u = umgebung(["1.0.0"]);
    manifesteImportieren(u, "b1", MORGEN, signiert("probe"));
    u.registry.stoppen();
    await u.v.abfragen();
    expect(u.uebersicht()[0]?.versionen.map((v) => v.zustand)).toEqual(["verfuegbar"]);
    expect(u.meldungen()).toHaveLength(2);
  });

  it("refuses a token realm off HTTPS when not redirected for tests", async () => {
    const u = umgebung(["1.0.0"], { token: true });
    manifesteImportieren(u, "b1", MORGEN, signiert("probe"));
    // the stand-in's realm is plain HTTP on localhost: allowed only while redirected
    const umgeleitet = ((url: string, init?: RequestInit) =>
      fetch(url.replace("https://registry.example.org", u.registry.url), init)) as typeof fetch;
    const r = await tagsAbfragen(
      { registry: "registry.example.org", name: "probe" },
      { fetch: umgeleitet },
    );
    expect(r).toMatchObject({ ok: false, fehler: expect.stringMatching(/Token-Adresse/) });
  });

  it("follows no redirect off the registry's HTTPS origin", async () => {
    const anderswo: string[] = [];
    const fremd = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (a) => {
        anderswo.push(a.url);
        return Response.json({ tags: ["9.9.9"] });
      },
    });
    // stands in for https://registry.example.org, which sends the tag list to plain HTTP elsewhere
    const umleitend = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.redirect(`http://localhost:${fremd.port}/v2/probe/tags/list`, 307),
    });
    try {
      const alsHttps = ((url: string, init?: RequestInit) =>
        fetch(
          url.replace("https://registry.example.org", `http://127.0.0.1:${umleitend.port}`),
          init,
        )) as typeof fetch;
      const r = await tagsAbfragen(
        { registry: "registry.example.org", name: "probe" },
        { fetch: alsHttps },
      );
      expect(anderswo).toEqual([]);
      expect(r).toMatchObject({ ok: false });
    } finally {
      umleitend.stop(true);
      fremd.stop(true);
    }
  });
});

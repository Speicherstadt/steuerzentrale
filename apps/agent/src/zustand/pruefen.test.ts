import { describe, expect, it } from "vitest";
import type { Nutzer } from "../einrichtung/nutzer.ts";
import { healthPruefen, unitsLesen } from "./pruefen.ts";
import { pruefDeps } from "./testdeps.ts";
import type { PruefZiel } from "./ziel.ts";

/*
 * BAULISTE.md Z-403, docs/plan.md "Health auf dem Server": each kind of health check against the
 * target kept from the signed manifest, within its time limit, and the units' ActiveState read as
 * the installation's user. With fakes for spawn, fetch, socket and clock (testdeps.ts).
 */

const N: Nutzer = { name: "sz-test-x", uid: 2001, gid: 2001, home: "/home/sz-test-x" };
const RUNUSER = [
  "runuser",
  "-u",
  "sz-test-x",
  "--",
  "env",
  "-i",
  "HOME=/home/sz-test-x",
  "USER=sz-test-x",
  "LOGNAME=sz-test-x",
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  "XDG_RUNTIME_DIR=/run/user/2001",
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/2001/bus",
];

const HTTP = { art: "http", port: 20001, pfad: "/health" } as const;

describe("health http", () => {
  it("GETs 127.0.0.1 on the kept port and path, without following redirects", async () => {
    const p = pruefDeps();
    expect(await healthPruefen(p.deps, HTTP, "test-x", N)).toEqual({
      zustand: "gruen",
      grund: "HTTP 200",
    });
    expect(p.gerufen.holen).toEqual([
      {
        url: "http://127.0.0.1:20001/health",
        init: expect.objectContaining({ method: "GET", redirect: "manual" }),
      },
    ]);
  });

  it("is green for 200 to 399, a redirect included, and red above", async () => {
    const mit = (status: number) =>
      healthPruefen(
        pruefDeps({
          holen: () =>
            new Response(null, { status, headers: { location: "http://anderswo.example/" } }),
        }).deps,
        HTTP,
        "test-x",
        N,
      );
    expect(await mit(204)).toEqual({ zustand: "gruen", grund: "HTTP 204" });
    expect(await mit(302)).toEqual({ zustand: "gruen", grund: "HTTP 302" });
    expect(await mit(399)).toEqual({ zustand: "gruen", grund: "HTTP 399" });
    expect(await mit(404)).toEqual({ zustand: "rot", grund: "HTTP 404" });
    expect(await mit(500)).toEqual({ zustand: "rot", grund: "HTTP 500" });
  });

  it("is red after 5 s without an answer, and when nothing listens", async () => {
    const p = pruefDeps({ holen: () => "haengt" });
    const lauf = healthPruefen(p.deps, HTTP, "test-x", N);
    expect(p.uhr.offen()).toEqual([5000]);
    p.uhr.ablaufen();
    expect(await lauf).toEqual({ zustand: "rot", grund: "keine Antwort in 5 s" });
    const zu = pruefDeps({ holen: () => new TypeError("ECONNREFUSED 127.0.0.1:20001 geheim") });
    expect(await healthPruefen(zu.deps, HTTP, "test-x", N)).toEqual({
      zustand: "rot",
      grund: "keine Verbindung zu 127.0.0.1:20001",
    });
  });
});

describe("health tcp", () => {
  const TCP = { art: "tcp", port: 20002 } as const;

  it("is green when a connection to 127.0.0.1 on the kept port opens", async () => {
    const p = pruefDeps();
    expect(await healthPruefen(p.deps, TCP, "test-x", N)).toEqual({
      zustand: "gruen",
      grund: "Verbindung zu 127.0.0.1:20002",
    });
    expect(p.gerufen.verbinden).toEqual([{ host: "127.0.0.1", port: 20002 }]);
  });

  it("is red when refused, and after 5 s", async () => {
    const zu = pruefDeps({ verbinden: () => new Error("ECONNREFUSED") });
    expect(await healthPruefen(zu.deps, TCP, "test-x", N)).toEqual({
      zustand: "rot",
      grund: "keine Verbindung zu 127.0.0.1:20002",
    });
    const p = pruefDeps({ verbinden: () => "haengt" });
    const lauf = healthPruefen(p.deps, TCP, "test-x", N);
    expect(p.uhr.offen()).toEqual([5000]);
    p.uhr.ablaufen();
    expect(await lauf).toEqual({ zustand: "rot", grund: "keine Verbindung in 5 s" });
  });
});

describe("health befehl", () => {
  const BEFEHL: Extract<PruefZiel, { art: "befehl" }> = {
    art: "befehl",
    container: "app",
    argv: ["bun", "/app/server.ts", "export"],
    zeitlimitMs: 30_000,
  };

  it("runs podman exec in the installation's container as its user; green at code 0", async () => {
    const p = pruefDeps();
    expect(await healthPruefen(p.deps, BEFEHL, "test-x", N)).toEqual({
      zustand: "gruen",
      grund: "Befehl endete mit Code 0",
    });
    expect(p.gerufen.spawn).toEqual([
      [...RUNUSER, "podman", "exec", "test-x-app", "bun", "/app/server.ts", "export"],
    ]);
  });

  it("is red at another code, and killed at its time limit", async () => {
    const rot = pruefDeps({ spawn: () => 3 });
    expect(await healthPruefen(rot.deps, BEFEHL, "test-x", N)).toEqual({
      zustand: "rot",
      grund: "Befehl endete mit Code 3",
    });
    const p = pruefDeps({ spawn: () => "haengt" });
    const lauf = healthPruefen(p.deps, { ...BEFEHL, zeitlimitMs: 4000 }, "test-x", N);
    expect(p.uhr.offen()).toEqual([4000]);
    p.uhr.ablaufen();
    expect(await lauf).toEqual({ zustand: "rot", grund: "Befehl nach 4 s abgebrochen" });
  });

  it("names no output or error text of the command in its reason", async () => {
    const p = pruefDeps({ spawn: () => new Error("podman: geheimer Wert 0815") });
    const h = await healthPruefen(p.deps, BEFEHL, "test-x", N);
    expect(h).toEqual({ zustand: "rot", grund: "Befehl startete nicht" });
  });

  it("is unknown without the installation's user, and runs nothing", async () => {
    const p = pruefDeps();
    expect(await healthPruefen(p.deps, BEFEHL, "test-x", undefined)).toEqual({
      zustand: "unbekannt",
      grund: "Nutzer der Installation fehlt",
    });
    expect(p.gerufen.spawn).toEqual([]);
  });
});

describe("health without a check", () => {
  it("keine checks nothing: unknown, reason „keine Prüfung“", async () => {
    const p = pruefDeps();
    expect(await healthPruefen(p.deps, { art: "keine" }, "test-x", N)).toEqual({
      zustand: "unbekannt",
      grund: "keine Prüfung",
    });
    expect(p.gerufen).toEqual({ spawn: [], lesen: [], holen: [], verbinden: [] });
  });

  it("a target the agent cannot check is unknown with its reason", async () => {
    const p = pruefDeps();
    const ziel = { art: "nicht_pruefbar", grund: "app:3000 ist nicht veröffentlicht" } as const;
    expect(await healthPruefen(p.deps, ziel, "test-x", N)).toEqual({
      zustand: "unbekannt",
      grund: "app:3000 ist nicht veröffentlicht",
    });
  });
});

describe("the units", () => {
  const UNITS = ["test-x-app.service", "test-x-worker.service"];

  it("reads Id and ActiveState with systemctl --user show as the installation's user", async () => {
    const p = pruefDeps({
      lesen: () => ({
        code: 0,
        aus: "ActiveState=active\nId=test-x-app.service\n\nId=test-x-worker.service\nActiveState=inactive\n",
      }),
    });
    expect(await unitsLesen(p.deps, UNITS, N)).toEqual([
      { name: "test-x-app.service", aktiv: "active" },
      { name: "test-x-worker.service", aktiv: "inactive" },
    ]);
    expect(p.gerufen.lesen).toEqual([
      [...RUNUSER, "systemctl", "--user", "show", "-p", "Id,ActiveState", "--", ...UNITS],
    ]);
  });

  it("maps what it cannot read to unknown: a strange state, a missing unit, a failed call", async () => {
    const seltsam = pruefDeps({
      lesen: () => ({ code: 0, aus: "Id=test-x-app.service\nActiveState=kaputt\n" }),
    });
    expect(await unitsLesen(seltsam.deps, UNITS, N)).toEqual([
      { name: "test-x-app.service", aktiv: "unknown" },
      { name: "test-x-worker.service", aktiv: "unknown" },
    ]);
    const fehler = pruefDeps({
      lesen: () => ({ code: 1, aus: "Id=test-x-app.service\nActiveState=active\n" }),
    });
    expect((await unitsLesen(fehler.deps, UNITS, N)).map((u) => u.aktiv)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(await unitsLesen(pruefDeps().deps, UNITS, undefined)).toEqual([
      { name: "test-x-app.service", aktiv: "unknown" },
      { name: "test-x-worker.service", aktiv: "unknown" },
    ]);
  });

  it("gives up after 10 s, everything unknown", async () => {
    const p = pruefDeps({ lesen: () => "haengt" });
    const lauf = unitsLesen(p.deps, UNITS, N);
    expect(p.uhr.offen()).toEqual([10_000]);
    p.uhr.ablaufen();
    expect((await lauf).map((u) => u.aktiv)).toEqual(["unknown", "unknown"]);
  });

  it("asks nothing for an installation without units", async () => {
    const p = pruefDeps();
    expect(await unitsLesen(p.deps, [], N)).toEqual([]);
    expect(p.gerufen.lesen).toEqual([]);
  });
});

import type { BeobachteterDienst } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import type { Nutzer } from "../einrichtung/nutzer.ts";
import { beobachteteLesen, beobachtetHalter, fremdeUnitsLesen } from "./beobachtet.ts";
import { type Antworten, pruefDeps } from "./testdeps.ts";

/*
 * BAULISTE.md Z-1103: the units of an observed service are read with `systemctl show` and nothing
 * else, as its user or of the system; its check goes to 127.0.0.1 as an installation's; a unit that
 * does not exist is unknown, never green; a name the pattern refuses is never put in an argv. The
 * argv of every call is recorded and compared whole.
 */

const TRISTAN: Nutzer = { name: "tristan", uid: 1000, gid: 1000, home: "/home/tristan" };

const lauf = (a: Antworten = {}) => {
  const p = pruefDeps(a);
  const deps = {
    ...p.deps,
    nutzer: async (name: string) => (name === "tristan" ? TRISTAN : undefined),
  };
  return { deps, gerufen: p.gerufen };
};

const show = (...bloecke: [string, string, string][]) => ({
  code: 0,
  aus: bloecke
    .map(([id, aktiv, geladen]) => `Id=${id}\nActiveState=${aktiv}\nLoadState=${geladen}\n`)
    .join("\n"),
});

const DIENST: BeobachteterDienst = {
  dienstId: "d1",
  nutzer: "tristan",
  units: ["kontext.service", "kontext-db.service"],
  health: { art: "http", port: 3000, pfad: "/health" },
};

describe("units of an observed service", () => {
  it("reads a user's units with systemctl show as that user, and nothing else", async () => {
    const { deps, gerufen } = lauf({
      lesen: () =>
        show(["kontext.service", "active", "loaded"], ["kontext-db.service", "failed", "loaded"]),
    });
    const units = await fremdeUnitsLesen(deps, DIENST.units, "tristan");
    expect(units).toEqual([
      { name: "kontext.service", aktiv: "active" },
      { name: "kontext-db.service", aktiv: "failed" },
    ]);
    expect(gerufen.lesen).toEqual([
      [
        "runuser",
        "-u",
        "tristan",
        "--",
        "env",
        "-i",
        "HOME=/home/tristan",
        "USER=tristan",
        "LOGNAME=tristan",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "XDG_RUNTIME_DIR=/run/user/1000",
        "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
        "systemctl",
        "--user",
        "show",
        "-p",
        "Id,ActiveState,LoadState",
        "--",
        "kontext.service",
        "kontext-db.service",
      ],
    ]);
    expect(gerufen.spawn).toEqual([]);
  });

  it("reads units of the system without a user", async () => {
    const { deps, gerufen } = lauf({ lesen: () => show(["caddy.service", "active", "loaded"]) });
    expect(await fremdeUnitsLesen(deps, ["caddy.service"], null)).toEqual([
      { name: "caddy.service", aktiv: "active" },
    ]);
    expect(gerufen.lesen).toEqual([
      ["systemctl", "show", "-p", "Id,ActiveState,LoadState", "--", "caddy.service"],
    ]);
  });

  it("takes a unit systemd does not know as unknown, never as inactive or green", async () => {
    const { deps } = lauf({ lesen: () => show(["fehlt.service", "inactive", "not-found"]) });
    expect(await fremdeUnitsLesen(deps, ["fehlt.service"], null)).toEqual([
      { name: "fehlt.service", aktiv: "unknown" },
    ]);
  });

  it("reads nothing for a user the server does not have", async () => {
    const { deps, gerufen } = lauf();
    expect(await fremdeUnitsLesen(deps, ["a.service"], "niemand")).toEqual([
      { name: "a.service", aktiv: "unknown" },
    ]);
    expect(gerufen.lesen).toEqual([]);
  });

  it.each([
    ["a unit with a space", ["a b.service"], "tristan"],
    ["a unit with ;", ["a;reboot.service"], "tristan"],
    ["a unit with /", ["../a.service"], null],
    ["a unit with a leading -", ["--host=x.service"], null],
    ["a user with a leading -", ["a.service"], "-u"],
    ["a user with /", ["a.service"], "a/b"],
  ])("puts %s in no argv", async (_, units, nutzer) => {
    const { deps, gerufen } = lauf();
    const gelesen = await fremdeUnitsLesen(deps, units, nutzer);
    expect(gelesen.every((u) => u.aktiv === "unknown")).toBe(true);
    expect(gerufen.lesen).toEqual([]);
    expect(gerufen.spawn).toEqual([]);
  });
});

describe("a round over the observed services", () => {
  it("reports each with its units and its check on 127.0.0.1", async () => {
    const { deps, gerufen } = lauf({
      lesen: () =>
        show(["kontext.service", "active", "loaded"], ["kontext-db.service", "active", "loaded"]),
      holen: () => new Response(null, { status: 204 }),
    });
    const tcp: BeobachteterDienst = {
      dienstId: "d2",
      nutzer: null,
      units: ["kontext.service"],
      health: { art: "tcp", port: 5432 },
    };
    const ohne: BeobachteterDienst = { ...tcp, dienstId: "d3", health: { art: "keine" } };
    expect(await beobachteteLesen(deps, [DIENST, tcp, ohne])).toEqual([
      {
        dienstId: "d1",
        units: [
          { name: "kontext.service", aktiv: "active" },
          { name: "kontext-db.service", aktiv: "active" },
        ],
        health: { zustand: "gruen", grund: "HTTP 204" },
      },
      {
        dienstId: "d2",
        units: [{ name: "kontext.service", aktiv: "active" }],
        health: { zustand: "gruen", grund: "Verbindung zu 127.0.0.1:5432" },
      },
      {
        dienstId: "d3",
        units: [{ name: "kontext.service", aktiv: "active" }],
        health: { zustand: "unbekannt", grund: "keine Prüfung" },
      },
    ]);
    expect(gerufen.holen.map((h) => h.url)).toEqual(["http://127.0.0.1:3000/health"]);
    expect(gerufen.verbinden).toEqual([{ host: "127.0.0.1", port: 5432 }]);
    // only systemctl show, three times, and no other program
    expect(gerufen.spawn).toEqual([]);
    const programme = gerufen.lesen.map((argv) => argv.slice(argv.indexOf("systemctl")));
    expect(programme.sort()).toEqual([
      ["systemctl", "--user", "show", "-p", "Id,ActiveState,LoadState", "--", ...DIENST.units],
      ["systemctl", "show", "-p", "Id,ActiveState,LoadState", "--", "kontext.service"],
      ["systemctl", "show", "-p", "Id,ActiveState,LoadState", "--", "kontext.service"],
    ]);
  });
});

describe("the list of observed services", () => {
  it("holds the newest list and nothing on a server that is managed", () => {
    const beobachtet = beobachtetHalter(true);
    expect(beobachtet.lesen()).toEqual([]);
    expect(beobachtet.setzen([DIENST])).toBe(true);
    expect(beobachtet.lesen()).toEqual([DIENST]);
    expect(beobachtet.setzen([])).toBe(true);
    expect(beobachtet.lesen()).toEqual([]);

    const verwaltet = beobachtetHalter(false);
    expect(verwaltet.setzen([DIENST])).toBe(false);
    expect(verwaltet.lesen()).toEqual([]);
  });
});

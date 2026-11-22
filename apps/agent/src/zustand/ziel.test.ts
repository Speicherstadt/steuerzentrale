import { manifestPruefen } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { EINRICHTUNG, MANIFEST } from "../einrichtung/testauftraege.ts";
import { pruefZiel } from "./ziel.ts";

/*
 * BAULISTE.md Z-403, docs/plan.md "Health auf dem Server": the target of the health check comes from
 * the signed manifest and the host ports the setup job assigned, rendered once at setup; never from
 * a later message of the Zentrale. The example app: netz.http app:8080 on httpPort 20001, and
 * app:9000 (not fixed) on 20002.
 */

const mit = (health: string, mehr = (t: string) => t) => {
  const text = mehr(MANIFEST.replace("health: { art: http, dienst: app, pfad: /health }", health));
  const g = manifestPruefen(text);
  if (!g.ok) throw new Error(g.fehler.join("\n"));
  return g.manifest;
};

const ziel = (health: string, mehr?: (t: string) => string) =>
  pruefZiel(mit(health, mehr), EINRICHTUNG.installation);

describe("the target of the health check", () => {
  it("http on the service of netz.http: its assigned host port on 127.0.0.1, with the path", () => {
    expect(ziel("health: { art: http, dienst: app, pfad: /health }")).toEqual({
      art: "http",
      port: 20001,
      pfad: "/health",
    });
    expect(ziel('health: { art: http, dienst: app, pfad: "/h?x=1", port: 8080 }')).toEqual({
      art: "http",
      port: 20001,
      pfad: "/h?x=1",
    });
  });

  it("http or tcp on a port of netz.ports: its assigned host port, or its own when fixed", () => {
    expect(ziel("health: { art: http, dienst: app, pfad: /x, port: 9000 }")).toEqual({
      art: "http",
      port: 20002,
      pfad: "/x",
    });
    expect(ziel("health: { art: tcp, dienst: app, port: 9000 }")).toEqual({
      art: "tcp",
      port: 20002,
    });
    const fest = (t: string) =>
      t.replace(
        "{ dienst: app, port: 9000, proto: tcp, fest: false }",
        "{ dienst: app, port: 9000, bis: 9002, proto: tcp, fest: true }",
      );
    expect(
      pruefZiel(mit("health: { art: tcp, dienst: app, port: 9001 }", fest), {
        ...EINRICHTUNG.installation,
        ports: {},
      }),
    ).toEqual({ art: "tcp", port: 9001 });
  });

  it("a port not published on the host cannot be checked, and says why", () => {
    expect(ziel("health: { art: tcp, dienst: app, port: 7000 }")).toEqual({
      art: "nicht_pruefbar",
      grund: "app:7000 ist auf dem Host nicht veröffentlicht",
    });
    // a udp port is no target for tcp or http
    const udp = (t: string) => t.replace("proto: tcp, fest: false", "proto: udp, fest: false");
    expect(ziel("health: { art: tcp, dienst: app, port: 9000 }", udp)).toMatchObject({
      art: "nicht_pruefbar",
    });
  });

  it("befehl: container and argv of the named command, at most 30 s", () => {
    expect(ziel("health: { art: befehl, befehl: export }")).toEqual({
      art: "befehl",
      container: "app",
      argv: ["bun", "/app/server.ts", "export"],
      zeitlimitMs: 30_000,
    });
    const kurz = (t: string) =>
      t.replace(
        "export: { container: app, argv: [bun, /app/server.ts, export] }",
        "export: { container: app, argv: [bun, /app/server.ts, export], zeitlimit_s: 4 }",
      );
    expect(ziel("health: { art: befehl, befehl: export }", kurz)).toMatchObject({
      zeitlimitMs: 4000,
    });
  });

  it("befehl with arguments cannot be checked: a health check gives none", () => {
    const mitArgument = (t: string) =>
      t.replace(
        "befehle:\n",
        `befehle:\n  pruefen: { container: app, argv: [bun, /app/server.ts, "$\{arg:was}"], argumente: { was: { typ: ja_nein } } }\n`,
      );
    expect(ziel("health: { art: befehl, befehl: pruefen }", mitArgument)).toEqual({
      art: "nicht_pruefbar",
      grund: "der Befehl pruefen braucht Argumente",
    });
  });

  it("keine checks nothing", () => {
    expect(ziel("health: { art: keine, hinweis: kein Endpunkt }")).toEqual({ art: "keine" });
  });
});

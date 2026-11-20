import { manifestPruefen, platzieren } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { VOM_AGENTEN_V1 } from "../../../../../packages/protokoll/src/beispiele-v1.ts";
import { mountFuer, platzServer, type ServerFakten, serverFakten } from "./fakten.ts";

/*
 * BAULISTE.md Z-304: placement uses the agent's facts without a detour, the same values in the
 * same shape: a `fakten` message as the agent sends it → PlatzServer → platzieren.
 */
const FAKTEN = VOM_AGENTEN_V1.find((n) => n.typ === "fakten") as ServerFakten;
const ZEILE = {
  betreiberId: "b1",
  art: "gemeinsam",
  kundeId: null,
  architektur: "amd64",
  fakten: JSON.stringify(FAKTEN),
};

const manifest = (netz: Record<string, unknown>, ramMb = 1024) => {
  const D = `ghcr.io/speicherstadt/app@sha256:${"1".repeat(64)}`;
  const geprueft = manifestPruefen(
    JSON.stringify({
      schema: 1,
      id: "app",
      version: "1.0.0",
      lizenz: "AGPL-3.0-only",
      quelle: "https://example.org/app",
      container: [{ name: "app", image: D }],
      architektur: ["amd64"],
      ressourcen: { ram_mb: ramMb, platte_gb: 10 },
      netz: { http: { dienst: "app", port: 3000 }, ...netz },
      anmeldung: "oidc",
      health: { art: "http", dienst: "app", pfad: "/health" },
      aktionen: { nur_lesen: "nicht_unterstuetzt", export: "nicht_unterstuetzt" },
    }),
  );
  if (!geprueft.ok) throw new Error(geprueft.fehler.join("\n"));
  return geprueft.manifest;
};

const platz = (f: ServerFakten | null, verbunden = true) => {
  const ergebnis = platzServer(ZEILE, f, verbunden);
  if (!ergebnis.ok) throw new Error(ergebnis.fehlt.join(", "));
  return ergebnis.server;
};

const anfrage = (server: ReturnType<typeof platz>, m = manifest({})) => ({
  manifest: m,
  optionen: [],
  server,
  installationen: [],
  kunde: { id: "k1", betreiberId: "b1", bietet: [] },
  betreiberWerte: [],
});

describe("facts → PlatzServer", () => {
  it("takes the agent's values as they are", () => {
    expect(platz(serverFakten(ZEILE))).toEqual({
      betreiberId: "b1",
      art: "gemeinsam",
      kundeId: null,
      agentVerbunden: true,
      architektur: "amd64",
      ramMb: 8192,
      platteFreiMb: 40960,
      platteGesamtMb: 81920,
      ipv4: ["203.0.113.10"],
      ptr: { "203.0.113.10": "server-a.example.org" },
      port25Ausgehend: false,
      portsBelegt: [{ port: 443, proto: "tcp" }],
    });
  });

  it("reads the disk that holds the installations' home directories", () => {
    const platten = [
      { mount: "/", gesamtMb: 20_000, freiMb: 10_000 },
      { mount: "/home", gesamtMb: 500_000, freiMb: 400_000 },
      { mount: "/homeoffice", gesamtMb: 1, freiMb: 1 },
    ];
    expect(mountFuer(platten, "/home/sz-")?.mount).toBe("/home");
    expect(mountFuer(platten.slice(0, 1), "/home/sz-")?.mount).toBe("/");
    expect(platz({ ...FAKTEN, platten })).toMatchObject({ platteGesamtMb: 500_000 });
  });

  it("names the facts it misses instead of guessing them", () => {
    expect(platzServer(ZEILE, null, true)).toEqual({
      ok: false,
      fehlt: ["ramMb", "platte", "ipv4", "portsBelegt"],
    });
    const ohne = { ...FAKTEN, architektur: null, ramMb: null, platten: [], portsBelegt: null };
    expect(platzServer({ ...ZEILE, architektur: null }, ohne, true)).toEqual({
      ok: false,
      fehlt: ["architektur", "ramMb", "platte", "portsBelegt"],
    });
    // the architecture the agent named in hallo is the agent's value too
    expect(platzServer(ZEILE, { ...FAKTEN, architektur: null }, true)).toMatchObject({ ok: true });
  });

  it("reads no stored text that is not a facts message", () => {
    expect(serverFakten({ fakten: null })).toBeNull();
    expect(serverFakten({ fakten: "{kaputt" })).toBeNull();
    expect(serverFakten({ fakten: JSON.stringify({ typ: "fakten" }) })).toBeNull();
  });
});

describe("facts → PlatzServer → platzieren", () => {
  it("fits an app into the server the facts describe", () => {
    expect(platzieren(anfrage(platz(FAKTEN)))).toEqual({ art: "passt", hinweise: [] });
  });

  it("decides by the facts: RAM, a fixed port in use, port 25 and PTR for mail", () => {
    expect(platzieren(anfrage(platz(FAKTEN), manifest({}, 8193)))).toMatchObject({
      art: "passt_nicht",
      gruende: [{ code: "ram" }],
    });
    const mail = manifest({ mail: true, ports: [{ dienst: "app", port: 443, fest: true }] });
    const p = platzieren(anfrage(platz(FAKTEN), mail));
    expect(p.art === "passt_nicht" ? p.gruende.map((g) => g.code) : []).toEqual([
      "port_belegt",
      "port25_gesperrt",
    ]);
    const offen = platz({ ...FAKTEN, port25Ausgehend: true, ptr: {} });
    const ohnePtr = platzieren(anfrage(offen, mail));
    expect(ohnePtr.art === "passt_nicht" ? ohnePtr.gruende.map((g) => g.code) : []).toEqual([
      "port_belegt",
      "kein_ptr",
    ]);
  });

  it("does not place on a server whose agent is gone", () => {
    expect(platzieren(anfrage(platz(FAKTEN, false)))).toMatchObject({
      art: "passt_nicht",
      gruende: [{ code: "agent_getrennt" }],
    });
  });
});

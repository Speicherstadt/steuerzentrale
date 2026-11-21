import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { befehlZurAktion } from "../befehl.ts";
import { beispielManifest, testManifest } from "../quadlet/testeingabe.ts";
import {
  istPforteAktion,
  PFORTE_AKTIONEN,
  PFORTE_PORT,
  type PforteAnfrage,
  pforteAuftragPruefen,
} from "./auftraege.ts";

const ROOT = join(import.meta.dirname, "../../../..");
const beispiel = beispielManifest(
  readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8"),
);

const setzen = (teil: Partial<PforteAnfrage> = {}): PforteAnfrage => ({
  aktion: PFORTE_AKTIONEN.setzen,
  installationId: "beispiel-k1",
  argumente: { host: "beispiel.kunde.example", port: 20001 },
  ...teil,
});

const grund = (a: PforteAnfrage, m = beispiel) => {
  const r = pforteAuftragPruefen(m, a);
  return r.ok ? "ok" : r.grund;
};

describe("the Pforte's jobs, built into the Steuerzentrale", () => {
  it("are no command any manifest can name: a command's name has no underscore", () => {
    for (const aktion of Object.values(PFORTE_AKTIONEN)) {
      expect(istPforteAktion(aktion)).toBe(true);
      expect(aktion).toContain("_");
      expect(() =>
        testManifest(
          readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8")
            .replaceAll("{{VERSION}}", "1.0.0")
            .replaceAll("{{IMAGE}}", `localhost:5000/beispiel@sha256:${"0".repeat(64)}`)
            .replaceAll("migrieren", aktion),
        ),
      ).toThrow(`befehle.${aktion}: Invalid key in record`);
    }
    expect(istPforteAktion("migrieren")).toBe(false);
    expect(befehlZurAktion(beispiel, PFORTE_AKTIONEN.setzen)).toBeUndefined();
  });

  it("render the route from the signed manifest with the installation, host and port", () => {
    const r = pforteAuftragPruefen(beispiel, setzen());
    expect(r).toMatchObject({
      ok: true,
      auftrag: {
        art: "setzen",
        route: {
          "@id": "beispiel-k1",
          match: [{ host: ["beispiel.kunde.example"] }],
          handle: [
            { handler: "request_body", max_size: 1024 * 1024 },
            {
              handler: "reverse_proxy",
              upstreams: [{ dial: "127.0.0.1:20001" }],
              transport: { protocol: "http", response_header_timeout: "30s" },
            },
          ],
        },
      },
    });
  });

  it("remove the route by the installation's name", () => {
    expect(
      pforteAuftragPruefen(beispiel, {
        aktion: PFORTE_AKTIONEN.entfernen,
        installationId: "beispiel-k1",
        argumente: {},
      }),
    ).toEqual({ ok: true, auftrag: { art: "entfernen", id: "beispiel-k1" } });
  });

  it.each([
    ["no installation", setzen({ installationId: null }), "installation"],
    [
      "an installation name with an underscore",
      setzen({ installationId: "sz_grund" }),
      "installation",
    ],
    ["a host with a path", setzen({ argumente: { host: "a.example/x", port: 20001 } }), "host"],
    ["a host in capitals", setzen({ argumente: { host: "A.EXAMPLE", port: 20001 } }), "host"],
    ["a host with a space", setzen({ argumente: { host: "a.example b", port: 20001 } }), "host"],
    ["a host without a dot", setzen({ argumente: { host: "localhost", port: 20001 } }), "host"],
    ["a port as text", setzen({ argumente: { host: "a.example", port: "20001" } }), "port"],
    ["a privileged port", setzen({ argumente: { host: "a.example", port: 443 } }), "port"],
    ["a port above 65535", setzen({ argumente: { host: "a.example", port: 70000 } }), "port"],
    ["a port with a fraction", setzen({ argumente: { host: "a.example", port: 20001.5 } }), "port"],
    ["a missing port", setzen({ argumente: { host: "a.example" } }), "port"],
    [
      "another argument",
      setzen({ argumente: { host: "a.example", port: 20001, upstream: "10.0.0.1:22" } }),
      "unknown argument",
    ],
    [
      "an argument when removing",
      {
        aktion: PFORTE_AKTIONEN.entfernen,
        installationId: "b-k1",
        argumente: { host: "a.example" },
      },
      "unknown argument",
    ],
    ["another action", setzen({ aktion: "pforte_neu_laden" }), "not a job of the Pforte"],
  ])("refuse %s", (_fall, anfrage, erwartet) => {
    expect(grund(anfrage)).toContain(erwartet);
  });

  it("refuse an app with a proxy of its own or without an HTTP service", () => {
    expect(grund(setzen(), { ...beispiel, proxy: "eigen" })).toContain("proxy");
    expect(grund(setzen(), { ...beispiel, netz: { ...beispiel.netz, http: null } })).toContain(
      "HTTP",
    );
  });

  it("take ports from 1024 to 65535", () => {
    expect(PFORTE_PORT).toEqual({ min: 1024, max: 65535 });
    const port = (p: number) => grund(setzen({ argumente: { host: "a.example", port: p } }));
    expect([port(1023), port(1024), port(65535)]).toEqual([
      expect.stringContaining("port"),
      "ok",
      "ok",
    ]);
  });
});

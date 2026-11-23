import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE, type Manifest } from "../schema.ts";
import { quadletsRendern } from "./rendern.ts";
import { PODMAN_4_9_SCHLUESSEL } from "./schluessel.ts";
import { unitLesen } from "./systemd.ts";
import {
  beispielManifest,
  goldeneDateien,
  testAnfrage,
  testFaelle,
  testManifest,
} from "./testeingabe.ts";

/*
 * Golden files (Z-205): every app of manifeste/ and the example app, alone and with each option,
 * rendered into packages/manifest/test/quadlets/<app>[@version][+option]/ (the version only for an
 * app with several, Z-1003). The agent test runs Podman's
 * generator over each units/ folder (apps/agent/test/quadlets.agent.test.ts).
 * `GOLDEN=schreiben bun run test` writes them anew after a deliberate change; then read the diff.
 */

const MANIFESTE = join(import.meta.dirname, "../../../../manifeste");
const GOLDEN = join(import.meta.dirname, "../../test/quadlets");
const schreiben = process.env.GOLDEN === "schreiben";

const ordner = (pfad: string) =>
  readdirSync(pfad, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/** Each manifest with its case's name: `<app>`, or `<app>@<version>` for an app with several */
const manifeste = (): { m: Manifest; name: string }[] => [
  ...ordner(MANIFESTE)
    .filter((app) => app !== "beispiel")
    .flatMap((app) => {
      const versionen = ordner(join(MANIFESTE, app));
      return versionen.map((v) => ({
        m: testManifest(readFileSync(join(MANIFESTE, app, v, "manifest.yml"), "utf8")),
        name: versionen.length > 1 ? `${app}@${v}` : app,
      }));
    }),
  {
    m: beispielManifest(readFileSync(join(MANIFESTE, "beispiel/manifest.vorlage.yml"), "utf8")),
    name: "beispiel",
  },
];

const faelle = manifeste().flatMap(({ m, name }) => testFaelle(m, name).map((f) => ({ ...f, m })));

const erwartet = (m: Manifest, optionen: string[]): Record<string, string> => {
  const r = quadletsRendern(testAnfrage(m, optionen));
  return r.ok
    ? goldeneDateien(r.quadlets)
    : {
        "abgelehnt.txt": `${r.gruende.map((g) => `${g.pfad.join(".")}: ${g.grund}`).join("\n")}\n`,
      };
};

const dateienIn = (wurzel: string): Record<string, string> => {
  const alle = (pfad: string): string[] =>
    readdirSync(pfad, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? alle(join(pfad, e.name)) : [join(pfad, e.name)],
    );
  return Object.fromEntries(
    alle(wurzel).map((d) => [relative(wurzel, d), readFileSync(d, "utf8")]),
  );
};

describe("golden files of the rendered units", () => {
  it("cover every case and nothing else", () => {
    expect(ordner(GOLDEN)).toEqual(faelle.map((f) => f.fall).sort());
  });

  it.each(faelle)("$fall", ({ fall, m, optionen }) => {
    const dateien = erwartet(m, optionen);
    if (schreiben) {
      rmSync(join(GOLDEN, fall), { recursive: true, force: true });
      for (const [pfad, inhalt] of Object.entries(dateien)) {
        mkdirSync(dirname(join(GOLDEN, fall, pfad)), { recursive: true });
        writeFileSync(join(GOLDEN, fall, pfad), inhalt);
      }
    }
    expect(dateienIn(join(GOLDEN, fall))).toEqual(dateien);
  });
});

const gerenderteUnits = faelle.flatMap(({ fall, m, optionen }) => {
  const r = quadletsRendern(testAnfrage(m, optionen));
  return r.ok
    ? Object.entries(r.quadlets.units).map(([datei, text]) => ({ fall, datei, text }))
    : [];
});

describe("every rendered unit", () => {
  it.each(gerenderteUnits)(
    "$fall/$datei uses only keys Podman 4.9 knows, never AutoUpdate",
    ({ text }) => {
      for (const { name, zeilen } of unitLesen(text)) {
        const erlaubt = PODMAN_4_9_SCHLUESSEL[name as keyof typeof PODMAN_4_9_SCHLUESSEL];
        if (!erlaubt) continue;
        for (const [schluessel] of zeilen) {
          expect(erlaubt).toContain(schluessel);
          expect(schluessel).not.toBe("AutoUpdate");
        }
      }
      expect(text).not.toMatch(/AutoUpdate/i);
    },
  );

  it.each(gerenderteUnits)(
    "$fall/$datei: images only by digest, HTTP only on 127.0.0.1",
    ({ text }) => {
      for (const { zeilen } of unitLesen(text))
        for (const [schluessel, wert] of zeilen) {
          if (schluessel === "Image") expect(wert).toMatch(IMAGE);
          if (schluessel === "PublishPort" && wert.split(":").length === 3)
            expect(wert).toMatch(/^127\.0\.0\.1:/);
        }
    },
  );

  it("the systemd sections hold only the keys rendering writes", () => {
    const systemd = new Set([
      "Description",
      "Requires",
      "After",
      "Slice",
      "MemoryMax",
      "Restart",
      "TimeoutStartSec",
      "WantedBy",
    ]);
    for (const { text } of gerenderteUnits)
      for (const { name, zeilen } of unitLesen(text))
        if (!(name in PODMAN_4_9_SCHLUESSEL))
          for (const [s] of zeilen) expect(systemd).toContain(s);
  });
});

describe("the HTTP service of an app behind the Pforte", () => {
  it.each(faelle.filter((f) => f.m.proxy === "geteilt" && f.m.netz.http))(
    "$fall publishes it only on 127.0.0.1",
    ({ m, optionen }) => {
      const r = quadletsRendern(testAnfrage(m, optionen));
      if (!r.ok)
        return expect(r.gruende.some((g) => g.grund.includes("no published image"))).toBe(true);
      const http = m.netz.http;
      const ports = Object.values(r.quadlets.units).flatMap((t) =>
        t.split("\n").filter((z) => z.startsWith("PublishPort=")),
      );
      expect(ports).toContain(`PublishPort=127.0.0.1:20001:${http?.port}`);
      expect(ports.filter((p) => p.endsWith(`:${http?.port}`))).toEqual([
        `PublishPort=127.0.0.1:20001:${http?.port}`,
      ]);
    },
  );
});

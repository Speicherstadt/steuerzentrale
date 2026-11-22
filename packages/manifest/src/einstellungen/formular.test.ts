import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testManifest } from "../quadlet/testeingabe.ts";
import type { Manifest } from "../schema.ts";
import {
  alleOptionen,
  befundeText,
  einstellungenPruefen,
  einstellungsFormular,
} from "./formular.ts";

/*
 * BAULISTE.md Z-404: the form of the settings comes from the manifest alone, for each of the eight
 * apps of manifeste/ and each level, and the check refuses what the form does not offer.
 */

const MANIFESTE = join(import.meta.dirname, "../../../../manifeste");
const ordner = (pfad: string) =>
  readdirSync(pfad, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
const APPS = ordner(MANIFESTE).filter((app) => app !== "beispiel");
const manifeste = APPS.flatMap((app) =>
  ordner(join(MANIFESTE, app)).map((v) => ({
    app,
    m: testManifest(readFileSync(join(MANIFESTE, app, v, "manifest.yml"), "utf8")),
  })),
);

const probe: Manifest = testManifest(`schema: 1
id: probe
version: 1.0.0
lizenz: AGPL-3.0-only
quelle: https://example.org/probe
container:
  - name: app
    image: registry.example.org/probe@sha256:${"1".repeat(64)}
    env: [P_LIZENZ, P_SCHALTER, P_TITEL, P_KENNWORT, P_LIMIT, P_EXTRA, P_URL, P_GEHEIM]
architektur: [amd64]
ressourcen: { ram_mb: 256, platte_gb: 1 }
netz: { http: { dienst: app, port: 8080 } }
optionen: [{ id: extra, name: Zusatz }]
anmeldung: eigen
health: { art: http, dienst: app, pfad: /health }
aktionen: { nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt }
env:
  - { name: P_LIZENZ, ebene: betreiber, typ: geheim, pflicht: true, beschreibung: Lizenz }
  - { name: P_SCHALTER, ebene: betreiber, typ: ja_nein, option: extra }
  - { name: P_TITEL, ebene: installation, pflicht: true, vorgabe: Probe }
  - { name: P_KENNWORT, ebene: installation, typ: geheim, pflicht: true }
  - { name: P_LIMIT, ebene: installation, typ: zahl }
  - { name: P_EXTRA, ebene: installation, option: extra }
  - { name: P_URL, ebene: auto, vorlage: "https://\${host}" }
  - { name: P_GEHEIM, ebene: auto, typ: geheim, erzeugen: zufall_32 }
`);

describe("the form of the settings", () => {
  it("is made for each of the eight apps and each level from the manifest alone", () => {
    expect(APPS).toHaveLength(8);
    for (const { m } of manifeste)
      for (const ebene of ["betreiber", "installation"] as const) {
        const felder = einstellungsFormular(m, ebene, alleOptionen(m));
        const erwartet = m.env.filter((e) => e.ebene === ebene && e.vorlage === undefined);
        expect(felder.map((f) => f.name)).toEqual(erwartet.map((e) => e.name));
        for (const f of felder) expect(f.geheim).toBe(f.typ === "geheim");
      }
  });

  it("knows no app by name", () => {
    const code = readFileSync(join(import.meta.dirname, "formular.ts"), "utf8").toLowerCase();
    for (const app of APPS) expect(code).not.toMatch(new RegExp(`\\b${app}\\b`));
  });

  it("asks for the level's fields with the options on, without templates and auto values", () => {
    expect(einstellungsFormular(probe, "installation", [])).toEqual([
      {
        name: "P_TITEL",
        typ: "text",
        pflicht: true,
        vorgabe: "Probe",
        beschreibung: undefined,
        geheim: false,
        option: undefined,
      },
      expect.objectContaining({ name: "P_KENNWORT", typ: "geheim", geheim: true, pflicht: true }),
      expect.objectContaining({ name: "P_LIMIT", typ: "zahl", pflicht: false }),
    ]);
    expect(einstellungsFormular(probe, "installation", ["extra"]).map((f) => f.name)).toContain(
      "P_EXTRA",
    );
    expect(einstellungsFormular(probe, "betreiber", alleOptionen(probe))).toEqual([
      expect.objectContaining({ name: "P_LIZENZ", geheim: true, beschreibung: "Lizenz" }),
      expect.objectContaining({ name: "P_SCHALTER", typ: "ja_nein", option: "extra" }),
    ]);
  });
});

describe("the check of the values", () => {
  const pruefen = (eingabe: Record<string, string | number | boolean>, optionen: string[] = []) =>
    einstellungenPruefen(probe, "installation", optionen, eingabe, {
      offen: { P_LIMIT: 3 },
      geheim: { P_KENNWORT: "alt" },
    });

  it("takes values of the fields and keeps what was not entered", () => {
    expect(pruefen({ P_TITEL: "Kanzlei", P_KENNWORT: "neu" })).toEqual({
      ok: true,
      werte: { offen: { P_TITEL: "Kanzlei", P_LIMIT: 3 }, geheim: { P_KENNWORT: "neu" } },
    });
  });

  it("keeps a secret when its field is left empty, and unsets an empty text", () => {
    expect(pruefen({ P_KENNWORT: "", P_LIMIT: "" })).toEqual({
      ok: true,
      werte: { offen: {}, geheim: { P_KENNWORT: "alt" } },
    });
  });

  it("refuses an unknown name, another level, a template, an option that is off and a wrong type", () => {
    const r = pruefen({ X: "1", P_LIZENZ: "l", P_URL: "u", P_EXTRA: "e", P_LIMIT: "zehn" });
    expect(r).toEqual({
      ok: false,
      befunde: [
        { name: "X", code: "unbekannt" },
        { name: "P_LIZENZ", code: "ebene" },
        { name: "P_URL", code: "ebene" },
        { name: "P_EXTRA", code: "kein_feld" },
        { name: "P_LIMIT", code: "typ" },
      ],
    });
    expect(pruefen({ P_EXTRA: "e" }, ["extra"]).ok).toBe(true);
    expect(pruefen({ P_GEHEIM: "g" })).toEqual({
      ok: false,
      befunde: [{ name: "P_GEHEIM", code: "ebene" }],
    });
  });

  it("refuses a required field without a value, unless it has a default", () => {
    const r = einstellungenPruefen(probe, "installation", [], { P_TITEL: "" });
    expect(r).toEqual({ ok: false, befunde: [{ name: "P_KENNWORT", code: "pflicht" }] });
    expect(r.ok ? "" : befundeText(r.befunde)).toBe("P_KENNWORT: required and without a value");
    expect(einstellungenPruefen(probe, "betreiber", [], {})).toEqual({
      ok: false,
      befunde: [{ name: "P_LIZENZ", code: "pflicht" }],
    });
    expect(einstellungenPruefen(probe, "betreiber", [], {}, undefined, { pflicht: false })).toEqual(
      { ok: true, werte: { offen: {}, geheim: {} } },
    );
  });
});

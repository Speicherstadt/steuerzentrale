import { manifestPruefen } from "../laden.ts";
import type { Manifest } from "../schema.ts";
import type { QuadletAnfrage, Quadlets, Wert } from "./typen.ts";

/*
 * Input for rendering in the tests and the golden files (packages/manifest/test/quadlets/): derived
 * from any manifest the same way, without a line for one app. Values are fixed text, so a golden
 * file changes only when rendering does; no real secret appears anywhere.
 */

type Einstellung = Manifest["env"][number];

/** A manifest from its text; an invalid one throws, since a test needs a valid one */
export const testManifest = (text: string): Manifest => {
  const g = manifestPruefen(text);
  if (!g.ok) throw new Error(g.fehler.join("\n"));
  return g.manifest;
};

/** The example app's template (manifeste/beispiel) with a version and a made-up digest */
export const beispielManifest = (vorlage: string): Manifest =>
  testManifest(
    vorlage
      .replaceAll("{{VERSION}}", "1.0.0")
      .replaceAll("{{IMAGE}}", `localhost:5000/beispiel@sha256:${"0".repeat(64)}`),
  );

const beispielWert = (e: Einstellung): Wert => {
  if (e.typ === "zahl") return 7;
  if (e.typ === "ja_nein") return true;
  if (e.typ === "geheim") return `test-geheim-${e.name.toLowerCase()}`;
  return `test-${e.name.toLowerCase()}`;
};

/** A value for every setting of a level that has no default; the default stays to be tested */
const werte = (m: Manifest, ebene: Einstellung["ebene"]): Record<string, Wert> =>
  Object.fromEntries(
    m.env
      .filter((e) => e.ebene === ebene && e.vorgabe === undefined)
      .map((e) => [e.name, beispielWert(e)]),
  );

/** What the Zentrale generated once (erzeugen) and what the OIDC provider gave (aus) */
const autoWerte = (m: Manifest): Record<string, Wert> =>
  Object.fromEntries(
    m.env.flatMap((e) => {
      if (e.erzeugen !== undefined) return [[e.name, `test-erzeugt-${e.name.toLowerCase()}`]];
      if (e.aus === "oidc-anbieter") return [[e.name, `test-oidc-${e.name.toLowerCase()}`]];
      return [];
    }),
  );

export const testAnfrage = (
  m: Manifest,
  optionen: string[],
  name = `${m.id}-k1`,
  erster = 20001,
): QuadletAnfrage => {
  const frei = m.netz.ports.filter((p) => !p.fest);
  const host = `${name}.kunde.example`;
  return {
    manifest: m,
    installation: {
      name,
      kundeId: "kunde-1",
      optionen,
      httpPort: m.netz.http ? erster : null,
      ports: Object.fromEntries(
        frei.map((p, i) => [`${p.dienst}:${p.port}`, erster + 100 + i * 1000]),
      ),
      adresse: `https://${host}`,
      host,
      ipv4: "203.0.113.10",
    },
    einstellungen: {
      betreiber: werte(m, "betreiber"),
      installation: werte(m, "installation"),
      auto: autoWerte(m),
    },
  };
};

/** Every case of the golden files: each app alone and with each of its options */
export const testFaelle = (m: Manifest): { fall: string; optionen: string[] }[] => [
  { fall: m.id, optionen: [] },
  ...m.optionen.map((o) => ({ fall: `${m.id}+${o.id}`, optionen: [o.id] })),
];

/** The rendered files as one map by path, the layout of a golden folder */
export const goldeneDateien = (q: Quadlets): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(q.units).map(([n, t]) => [`units/${n}`, t])),
  ...Object.fromEntries(Object.entries(q.systemd).map(([n, t]) => [`systemd/${n}`, t])),
  ...Object.fromEntries(Object.entries(q.dateien).map(([n, t]) => [`dateien/${n}`, t])),
  "secrets.json": `${JSON.stringify(q.secrets, null, 2)}\n`,
  "pforte.json": `${JSON.stringify(q.pforte, null, 2)}\n`,
});

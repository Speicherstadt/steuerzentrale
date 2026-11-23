import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type Manifest, schluesselLesen, signiertesManifestLaden } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { kommentar, MANIFESTE, manifestDateien } from "./manifeste-signieren.ts";

// The apps of docs/plan.md, "Die Apps der Speicherstadt" (Z-203)
const APPS = [
  "haben",
  "belegt",
  "kontext",
  "schreibzeug",
  "stellwerk",
  "fixpunkt",
  "kennwort",
  "soll",
];
const root = join(import.meta.dirname, "..");

const testSchluessel = () => {
  const s = schluesselLesen(readFileSync(join(root, "test/schluessel/test.pub"), "utf8"));
  if (!s) throw new Error("test key");
  return s;
};

const laden = (datei: string): Manifest => {
  const geladen = signiertesManifestLaden(
    readFileSync(datei),
    readFileSync(`${datei}.minisig`, "utf8"),
    testSchluessel(),
  );
  if (!geladen.ok) throw new Error(`${relative(root, datei)}:\n${geladen.fehler.join("\n")}`);
  return geladen.manifest;
};

const dateien = manifestDateien();
const faelle = dateien.map((datei) => [relative(MANIFESTE, datei), datei] as const);

describe("the manifests of the Speicherstadt (Z-203)", () => {
  it("exist for all eight apps and for nothing else", () => {
    const apps = new Set(dateien.map((d) => relative(MANIFESTE, d).split("/")[0]));
    expect([...apps].sort()).toEqual([...APPS].sort());
  });

  // Z-1003 updates Schreibzeug and Haben from one released version to the next; every other app
  // keeps one version
  it("hold two versions only for the apps the update test needs", () => {
    const versionen = Map.groupBy(
      dateien.map((d) => relative(MANIFESTE, dirname(d)).split("/")),
      ([app]) => app,
    );
    const mehrere = [...versionen].filter(([, v]) => v.length > 1);
    expect(Object.fromEntries(mehrere.map(([app, v]) => [app, v.map(([, x]) => x)]))).toEqual({
      haben: ["0.12.0", "0.12.0-rc.1"],
      schreibzeug: ["0.1.25", "0.1.26"],
    });
  });

  it.each(faelle)("%s is valid and signed with the test key", (_name, datei) => {
    const m = laden(datei);
    const [app, version] = relative(MANIFESTE, dirname(datei)).split("/");
    expect([m.id, m.version]).toEqual([app, version]);
    expect(readFileSync(`${datei}.minisig`, "utf8")).toContain(
      `trusted comment: ${kommentar(readFileSync(datei, "utf8"))}`,
    );
  });
});

/** Every name a manifest gives that QUELLEN.md must account for */
const namen = (m: Manifest): string[] => {
  const container = [...m.container, ...m.optionen.flatMap((o) => o.container)];
  return [
    ...container.map((c) => c.name),
    ...container.flatMap((c) => c.volumes.map((v) => v.name)),
    ...container.flatMap((c) => Object.keys(c.feste_env)),
    ...m.env.map((e) => e.name),
    ...Object.keys(m.befehle),
    ...m.optionen.map((o) => o.id),
  ];
};

describe("QUELLEN.md next to each manifest", () => {
  it.each(faelle)("%s: names every top-level field, container, volume and setting", (_n, datei) => {
    const quellen = readFileSync(join(dirname(datei), "QUELLEN.md"), "utf8");
    // Top-level keys start a line without indentation
    const felder = [...readFileSync(datei, "utf8").matchAll(/^([a-z_]+):/gm)].map(([, f]) => f);
    const fehlt = [...felder, ...namen(laden(datei))].filter(
      (name) => !quellen.includes(`\`${name}\``),
    );
    expect(fehlt).toEqual([]);
  });

  it.each(faelle)("%s: names the app's repository and the commit read", (_n, datei) => {
    const quellen = readFileSync(join(dirname(datei), "QUELLEN.md"), "utf8");
    const m = laden(datei);
    expect(quellen).toContain(m.quelle);
    expect(quellen).toMatch(/Commit\s+`[0-9a-f]{40}`/);
  });

  it.each(faelle)("%s: gives each digest its source (registry, tag, date)", (_n, datei) => {
    const quellen = readFileSync(join(dirname(datei), "QUELLEN.md"), "utf8");
    const m = laden(datei);
    for (const c of [...m.container, ...m.optionen.flatMap((o) => o.container)]) {
      if (typeof c.image !== "string") {
        expect(quellen, `${c.name} without image`).toContain("noch nicht veröffentlicht");
        continue;
      }
      const zeile = quellen.split("\n").find((z) => z.includes(`\`${c.image}\``));
      expect(zeile, `${c.image} is not in QUELLEN.md`).toBeDefined();
      const registry = c.image.split("/")[0];
      expect(zeile).toMatch(
        new RegExp(`Registry ${registry}, Tag [^,]+, abgefragt am \\d{4}-\\d{2}-\\d{2}`),
      );
    }
  });

  it.each(faelle)("%s: records the SHA-256 of every configuration file", (_n, datei) => {
    const quellen = readFileSync(join(dirname(datei), "QUELLEN.md"), "utf8");
    const m = laden(datei);
    for (const c of [...m.container, ...m.optionen.flatMap((o) => o.container)])
      for (const d of c.dateien)
        expect(quellen, `${c.name}: ${d.pfad}`).toContain(
          createHash("sha256").update(d.inhalt).digest("hex"),
        );
  });

  it("is there for every manifest and nowhere else", () => {
    const quellen = APPS.flatMap((app) =>
      readdirSync(join(MANIFESTE, app), { recursive: true, encoding: "utf8" })
        .filter((d) => d.endsWith("QUELLEN.md"))
        .map((d) => join(MANIFESTE, app, d)),
    );
    expect(quellen.sort()).toEqual(dateien.map((d) => join(dirname(d), "QUELLEN.md")).sort());
  });
});

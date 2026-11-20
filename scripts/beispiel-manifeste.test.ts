import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schluesselLesen, signiertesManifestLaden } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { beispielManifesteSchreiben } from "./beispiel-manifeste.ts";

const root = join(import.meta.dirname, "..");
const ziel = mkdtempSync(join(tmpdir(), "sz-test-beispiel-"));
afterAll(() => rmSync(ziel, { recursive: true, force: true }));

const testSchluessel = () => {
  const s = schluesselLesen(readFileSync(join(root, "test/schluessel/test.pub"), "utf8"));
  if (!s) throw new Error("test key");
  return s;
};

describe("the example app's manifests", () => {
  // In CI the digests come from the images just built (apps/agent/test/beispiel.agent.test.ts)
  const varianten = ["1.0.0", "2.0.0", "2.1.0"].map((version, i) => ({
    version,
    image: `localhost:5000/beispiel@sha256:${String(i).repeat(64)}`,
  }));

  it("are valid, signed with the test key and carry version and digest", () => {
    for (const [i, ordner] of beispielManifesteSchreiben(ziel, varianten).entries()) {
      const geladen = signiertesManifestLaden(
        readFileSync(join(ordner, "manifest.yml")),
        readFileSync(join(ordner, "manifest.yml.minisig"), "utf8"),
        testSchluessel(),
      );
      if (!geladen.ok) throw new Error(geladen.fehler.join("\n"));
      expect(geladen.manifest.version).toBe(varianten[i]?.version);
      expect(geladen.manifest.container[0]?.image).toBe(varianten[i]?.image);
    }
  });

  it("have what Z-202 asks for: SQLite volume, health, an option, a step after the update, an assigned port, a backup of two parts", () => {
    const [ordner] = beispielManifesteSchreiben(ziel, varianten.slice(0, 1));
    const geladen = signiertesManifestLaden(
      readFileSync(join(ordner ?? "", "manifest.yml")),
      readFileSync(join(ordner ?? "", "manifest.yml.minisig"), "utf8"),
      testSchluessel(),
    );
    if (!geladen.ok) throw new Error(geladen.fehler.join("\n"));
    const m = geladen.manifest;
    expect(m.container[0]?.volumes).toEqual([{ name: "daten", pfad: "/daten" }]);
    expect(m.health).toMatchObject({ art: "http", pfad: "/health" });
    expect(m.optionen).toHaveLength(1);
    expect(m.schritte.nach_update).toEqual(["migrieren"]);
    expect(m.netz.ports).toEqual([expect.objectContaining({ fest: false })]);
    expect(m.backup).toHaveLength(2);
  });
});

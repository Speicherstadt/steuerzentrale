/**
 * Signs every app manifest under manifeste/<app>/<version>/manifest.yml with the public test key
 * (Z-203): `manifest.yml.minisig` next to it. Until a person signs them with the real key
 * (BAULISTE.md, "Schritte für Menschen"; docs/manifest.md, "Signatur"), the agent accepts them
 * only in tests, since release builds refuse the test key (packages/manifest, vertrauen.ts).
 * Ed25519 is deterministic, so signing an unchanged manifest again writes the same file.
 *
 * `bun scripts/manifeste-signieren.ts` after changing a manifest.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifestPruefen } from "@steuerzentrale/manifest";
import { geheimenSchluesselLesen, signieren } from "./minisign.ts";

const ROOT = join(import.meta.dirname, "..");
export const MANIFESTE = join(ROOT, "manifeste");
const TEST_SCHLUESSEL = join(ROOT, "test/schluessel/test.key");

const ordner = (pfad: string): string[] =>
  readdirSync(pfad, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/** Every manifest.yml one level below an app folder; the example app keeps only its template */
export const manifestDateien = (wurzel = MANIFESTE): string[] =>
  ordner(wurzel).flatMap((app) =>
    ordner(join(wurzel, app))
      .map((version) => join(wurzel, app, version, "manifest.yml"))
      .filter((datei) => existsSync(datei)),
  );

/** The trusted comment: app, version and that the test key signed it; an invalid manifest throws */
export const kommentar = (inhalt: string): string => {
  const geprueft = manifestPruefen(inhalt);
  if (!geprueft.ok) throw new Error(geprueft.fehler.join("\n"));
  return `${geprueft.manifest.id} ${geprueft.manifest.version} (test key)`;
};

export const manifesteSignieren = (wurzel = MANIFESTE): string[] => {
  const schluessel = geheimenSchluesselLesen(readFileSync(TEST_SCHLUESSEL, "utf8"));
  return manifestDateien(wurzel).map((datei) => {
    const inhalt = readFileSync(datei);
    writeFileSync(
      `${datei}.minisig`,
      signieren(inhalt, schluessel, kommentar(inhalt.toString("utf8"))),
    );
    return datei;
  });
};

if (import.meta.main) for (const datei of manifesteSignieren()) console.log(`${datei}.minisig`);

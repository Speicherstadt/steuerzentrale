/**
 * Writes the example app's manifests from manifeste/beispiel/manifest.vorlage.yml, one per version
 * with the digest of the image CI has just built, each signed with the public test key (Z-202;
 * docs/plan.md, "Signaturen in Tests"). Only the template is checked in.
 *
 * `bun scripts/beispiel-manifeste.ts <dir> <version>=<image@digest> …` writes
 * `<dir>/<version>/manifest.yml` and `manifest.yml.minisig`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { geheimenSchluesselLesen, signieren } from "./minisign.ts";

const ROOT = join(import.meta.dirname, "..");
export const VORLAGE = join(ROOT, "manifeste/beispiel/manifest.vorlage.yml");
const TEST_SCHLUESSEL = join(ROOT, "test/schluessel/test.key");

export type Variante = { version: string; image: string };

export const beispielManifest = (vorlage: string, variante: Variante): string =>
  vorlage.replaceAll("{{VERSION}}", variante.version).replaceAll("{{IMAGE}}", variante.image);

export const beispielManifesteSchreiben = (
  ziel: string,
  varianten: readonly Variante[],
): string[] => {
  const vorlage = readFileSync(VORLAGE, "utf8");
  const schluessel = geheimenSchluesselLesen(readFileSync(TEST_SCHLUESSEL, "utf8"));
  return varianten.map((variante) => {
    const ordner = join(ziel, variante.version);
    mkdirSync(ordner, { recursive: true });
    const inhalt = new TextEncoder().encode(beispielManifest(vorlage, variante));
    writeFileSync(join(ordner, "manifest.yml"), inhalt);
    writeFileSync(
      join(ordner, "manifest.yml.minisig"),
      signieren(inhalt, schluessel, `beispiel ${variante.version} (test key)`),
    );
    return ordner;
  });
};

if (import.meta.main) {
  const [ziel, ...paare] = process.argv.slice(2);
  const varianten = paare.map((paar) => {
    const [version, image] = paar.split("=");
    if (!version || !image) throw new Error(`expected <version>=<image@digest>, got ${paar}`);
    return { version, image };
  });
  if (!ziel || varianten.length === 0) {
    console.error("usage: beispiel-manifeste.ts <dir> <version>=<image@digest> …");
    process.exit(2);
  }
  for (const ordner of beispielManifesteSchreiben(ziel, varianten)) console.log(ordner);
}

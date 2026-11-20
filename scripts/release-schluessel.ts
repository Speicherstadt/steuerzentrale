/**
 * The check a release build runs on the public key it embeds for manifests and agent binaries:
 * `bun scripts/release-schluessel.ts <key.pub>` fails for the public test key (docs/plan.md,
 * "Signaturen in Tests"; Z-1004 calls it before building a release).
 */
import { readFileSync } from "node:fs";
import { schluesselLesen, schluesselVertrauen } from "@steuerzentrale/manifest";

export const releaseSchluesselPruefen = (
  text: string,
): { ok: true; id: string } | { ok: false; grund: string } => {
  const schluessel = schluesselLesen(text);
  if (!schluessel) return { ok: false, grund: "no minisign public key" };
  const vertrauen = schluesselVertrauen(schluessel, "release");
  return vertrauen.ok ? { ok: true, id: schluessel.id } : vertrauen;
};

if (import.meta.main) {
  const pfad = process.argv[2];
  const ergebnis = pfad
    ? releaseSchluesselPruefen(readFileSync(pfad, "utf8"))
    : { ok: false as const, grund: "usage: release-schluessel.ts <key.pub>" };
  if (!ergebnis.ok) {
    console.error(ergebnis.grund);
    process.exit(1);
  }
  console.log(`release key ${ergebnis.id}`);
}

/**
 * Lays out the directory the Zentrale serves under agent.<domain> (STEUERZENTRALE_AGENT_DATEIEN,
 * BAULISTE.md Z-302): `bun scripts/agent-dateien.ts <directory>` copies the agent binaries of
 * `bun run build` and install/install.sh there, writes SHA256SUMS and signs it with the public test
 * key, with its public half as minisign.pub. That is a release candidate for CI's test servers only:
 * install.sh accepts the test key only with --testmodus. For a release a person signs SHA256SUMS
 * with the real key (`minisign -Sm SHA256SUMS`) and puts its public key in minisign.pub
 * (docs/plan.md, "Release").
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TARGETS } from "./compile.ts";
import { geheimenSchluesselLesen, signieren } from "./minisign.ts";

const ROOT = join(import.meta.dirname, "..");

export const binaryName = (target: string) => `steuerzentrale-agent-${target}`;

/** The lines of `sha256sum` (hash, two spaces, name), which `sha256sum -c` reads */
export const pruefsummen = (dateien: { name: string; inhalt: Uint8Array }[]): string =>
  dateien
    .map(({ name, inhalt }) => `${createHash("sha256").update(inhalt).digest("hex")}  ${name}\n`)
    .join("");

/** SHA256SUMS and its signature with the test key for the files in `ordner` */
export const testSignieren = (ordner: string, namen: string[], kommentar: string): void => {
  const summen = pruefsummen(
    namen.map((name) => ({ name, inhalt: readFileSync(join(ordner, name)) })),
  );
  writeFileSync(join(ordner, "SHA256SUMS"), summen);
  const schluessel = geheimenSchluesselLesen(
    readFileSync(join(ROOT, "test/schluessel/test.key"), "utf8"),
  );
  writeFileSync(
    join(ordner, "SHA256SUMS.minisig"),
    signieren(new TextEncoder().encode(summen), schluessel, kommentar),
  );
  copyFileSync(join(ROOT, "test/schluessel/test.pub"), join(ordner, "minisign.pub"));
};

if (import.meta.main) {
  const ziel = process.argv[2];
  if (!ziel) {
    console.error("usage: bun scripts/agent-dateien.ts <directory>");
    process.exit(2);
  }
  mkdirSync(ziel, { recursive: true });
  const namen = TARGETS.map(binaryName);
  for (const name of namen) copyFileSync(join(ROOT, "apps/agent/dist", name), join(ziel, name));
  copyFileSync(join(ROOT, "install/install.sh"), join(ziel, "install.sh"));
  testSignieren(ziel, namen, "steuerzentrale-agent release candidate (test key)");
  console.log(`agent files in ${ziel}, signed with the public test key`);
}

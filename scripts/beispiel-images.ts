/**
 * Builds the example app's images in CI (Z-202): a local registry in a container, three variants
 * built from manifeste/beispiel/app and pushed there (1.0.0, 2.0.0, and 2.1.0 with health red), and
 * their manifests with the pushed digests, signed with the test key. Needs Podman; the agent tests
 * (vitest.agent.config.ts) run it once before they start. Writes to test-results/beispiel/.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beispielManifesteSchreiben, type Variante } from "./beispiel-manifeste.ts";

const ROOT = join(import.meta.dirname, "..");
export const REGISTRY = "localhost:5000";
export const REGISTRY_CONTAINER = "sz-test-registry";
export const AUSGABE = join(ROOT, "test-results/beispiel");
// The local registry of the tests (CNCF distribution); never on a managed server
const REGISTRY_IMAGE = "docker.io/library/registry:2";

export const VARIANTEN = [
  { version: "1.0.0", kaputt: false },
  { version: "2.0.0", kaputt: false },
  { version: "2.1.0", kaputt: true },
] as const;

const podman = (...args: string[]): string => {
  const lauf = Bun.spawnSync(["podman", ...args], { stderr: "pipe" });
  if (lauf.exitCode !== 0) throw new Error(`podman ${args.join(" ")}: ${lauf.stderr.toString()}`);
  return lauf.stdout.toString().trim();
};

const registryStarten = (): void => {
  const laeuft =
    Bun.spawnSync(["podman", "container", "exists", REGISTRY_CONTAINER]).exitCode === 0;
  if (!laeuft)
    podman(
      "run",
      "-d",
      "--rm",
      "--name",
      REGISTRY_CONTAINER,
      "-p",
      "127.0.0.1:5000:5000",
      REGISTRY_IMAGE,
    );
};

const bauen = (version: string, kaputt: boolean): Variante => {
  const tag = `${REGISTRY}/beispiel:${version}`;
  podman(
    "build",
    "--build-arg",
    `VERSION=${version}`,
    "--build-arg",
    `KAPUTT=${kaputt ? 1 : 0}`,
    "-t",
    tag,
    join(ROOT, "manifeste/beispiel/app"),
  );
  const digestDatei = join(AUSGABE, `${version}.digest`);
  podman("push", "--tls-verify=false", "--digestfile", digestDatei, tag);
  const digest = readFileSync(digestDatei, "utf8").trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`no digest for ${tag}: ${digest}`);
  return { version, image: `${REGISTRY}/beispiel@${digest}` };
};

export const beispielImagesBauen = (): Variante[] => {
  rmSync(AUSGABE, { recursive: true, force: true });
  mkdirSync(AUSGABE, { recursive: true });
  registryStarten();
  const varianten = VARIANTEN.map((v) => bauen(v.version, v.kaputt));
  beispielManifesteSchreiben(join(AUSGABE, "manifeste"), varianten);
  return varianten;
};

if (import.meta.main) for (const v of beispielImagesBauen()) console.log(`${v.version} ${v.image}`);

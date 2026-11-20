import { readFileSync } from "node:fs";
import { join } from "node:path";
import { schluesselLesen, signiertesManifestLaden } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { AUSGABE, REGISTRY, VARIANTEN } from "../../../scripts/beispiel-images.ts";
import { requirePodman } from "./podman.ts";

// The images and manifests come from beispiel-setup.ts (globalSetup of vitest.agent.config.ts)
const podman = requirePodman(process.env.CI === "true");
const root = join(import.meta.dirname, "../../..");
const testSchluessel = () => {
  const s = schluesselLesen(readFileSync(join(root, "test/schluessel/test.pub"), "utf8"));
  if (!s) throw new Error("test key");
  return s;
};
const manifest = (version: string) => {
  const ordner = join(AUSGABE, "manifeste", version);
  const geladen = signiertesManifestLaden(
    readFileSync(join(ordner, "manifest.yml")),
    readFileSync(join(ordner, "manifest.yml.minisig"), "utf8"),
    testSchluessel(),
  );
  if (!geladen.ok) throw new Error(geladen.fehler.join("\n"));
  return geladen.manifest;
};

const gestartet: string[] = [];
afterAll(() => {
  for (const name of gestartet) Bun.spawnSync(["podman", "rm", "-f", name]);
});

const health = async (port: number): Promise<number> => {
  for (let versuch = 0; versuch < 60; versuch++) {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).status;
    } catch {
      await Bun.sleep(250);
    }
  }
  throw new Error(`no answer on ${port}`);
};

describe.skipIf(podman === null)("the example app in CI", () => {
  it("has three images in the local registry and a valid, signed manifest for each", () => {
    const images = VARIANTEN.map((v) => manifest(v.version).container[0]?.image);
    expect(new Set(images).size).toBe(3);
    for (const image of images)
      expect(image).toMatch(new RegExp(`^${REGISTRY}/beispiel@sha256:[0-9a-f]{64}$`));
  });

  it.each(VARIANTEN.map((v, i) => [v.version, v.kaputt, 18_181 + i] as const))(
    "version %s answers on /health (broken: %s)",
    async (version, kaputt, port) => {
      const image = manifest(version).container[0]?.image;
      if (typeof image !== "string") throw new Error(`no image in beispiel ${version}`);
      const name = `sz-test-beispiel-${version.replaceAll(".", "-")}`;
      const lauf = Bun.spawnSync([
        "podman",
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        "--tls-verify=false",
        "-p",
        `127.0.0.1:${port}:8080`,
        image,
      ]);
      expect(lauf.exitCode, lauf.stderr.toString()).toBe(0);
      gestartet.push(name);
      expect(await health(port)).toBe(kaputt ? 500 : 200);
    },
    60_000,
  );
});

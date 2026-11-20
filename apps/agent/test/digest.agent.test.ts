import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUSGABE, REGISTRY } from "../../../scripts/beispiel-images.ts";
import { digestAbfragen } from "../../../scripts/digest.ts";
import { requirePodman } from "./podman.ts";

// beispiel-setup.ts (globalSetup) starts the local registry and pushes the example app's images;
// podman push --digestfile wrote the digest each push produced (scripts/beispiel-images.ts)
const podman = requirePodman(process.env.CI === "true");

describe.skipIf(podman === null)("scripts/digest.ts against the local registry (Z-203)", () => {
  it("translates localhost:5000/beispiel:1.0.0 into the digest podman pushed", async () => {
    const gepusht = readFileSync(join(AUSGABE, "1.0.0.digest"), "utf8").trim();
    const a = await digestAbfragen(`${REGISTRY}/beispiel:1.0.0`, {
      fetch,
      jetzt: () => new Date(),
    });
    if (!a.ok) throw new Error(a.fehler);
    expect(a.image).toBe(`${REGISTRY}/beispiel@${gepusht}`);
    expect(a.quelle).toMatchObject({ registry: REGISTRY, tag: "1.0.0" });
  });

  it("returns an error for a tag the registry does not have", async () => {
    const a = await digestAbfragen(`${REGISTRY}/beispiel:0.0.0-fehlt`, {
      fetch,
      jetzt: () => new Date(),
    });
    expect(a.ok).toBe(false);
  });
});

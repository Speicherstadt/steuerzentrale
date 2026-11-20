import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { atLeast, requirePodman } from "./podman.ts";

// Run by `bun run test:agent` (vitest.agent.config.ts), in CI on ubuntu-24.04 with Podman 4.9
const podman = requirePodman(process.env.CI === "true");
const hostTarget = process.arch === "arm64" ? "linux-arm64" : "linux-x64";

describe.skipIf(podman === null)("agent against Podman", () => {
  it("finds Podman 4.9 or newer, the minimum of docs/plan.md", () => {
    expect(atLeast(podman ?? "0", "4.9")).toBe(true);
  });

  it("starts as compiled binary and reports its version", () => {
    const out = join(mkdtempSync(join(tmpdir(), "sz-test-agent-")), "steuerzentrale-agent");
    const entry = join(import.meta.dirname, "../src/main.ts");
    const build = Bun.spawnSync([
      "bun",
      "build",
      "--compile",
      `--target=bun-${hostTarget}`,
      entry,
      "--outfile",
      out,
    ]);
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    const run = Bun.spawnSync([out, "--version"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe(
      `steuerzentrale-agent ${VERSION} (protokoll ${PROTOKOLL_VERSION})`,
    );
  }, 120_000);
});

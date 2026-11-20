import { defineConfig } from "vitest/config";

// `bun run test:agent`: the agent against real Podman with systemd (docs/plan.md, "Tests"). No
// --passWithNoTests: a run without a test fails, and with CI=true a missing Podman fails it too
// (apps/agent/test/podman.ts).
export default defineConfig({
  test: { include: ["apps/agent/**/*.agent.test.ts"], testTimeout: 120_000, pool: "threads" },
});

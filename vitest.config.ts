import { defineConfig } from "vitest/config";

// One run over the whole monorepo; packages keep their tests next to the code. Z-101 adds the
// workspaces here (pure logic in "logic", the Solid UI in its own project with a DOM); the agent's
// tests against Podman run under `bun run test:agent`. scripts/workspaces.test.ts fails when a
// workspace is in no project.
const logic = ["scripts"];
const tests = (dirs: string[]) => dirs.map((dir) => `${dir}/**/*.test.{ts,tsx}`);

export default defineConfig({
  test: {
    projects: [{ test: { name: "logic", include: tests(logic) } }],
  },
});

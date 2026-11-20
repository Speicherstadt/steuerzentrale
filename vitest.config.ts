import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// One run over the whole monorepo; packages keep their tests next to the code. Logic runs without a
// DOM, the Solid UI in happy-dom on Solid's dev build, whose diagnostics fail a test
// (vitest.solid-diagnostics.ts, from Speicherstadt/kennwort). The agent's tests against Podman
// (*.agent.test.ts) run under `bun run test:agent`. scripts/workspaces.test.ts fails when a
// workspace is in no project.
const logic = [
  "scripts",
  "packages/manifest",
  "packages/protokoll",
  "packages/planung",
  "apps/zentrale",
  "apps/agent",
  "manifeste/beispiel/app",
];
const interfaces = ["packages/ui", "apps/web"];
const tests = (dirs: string[]) => dirs.map((dir) => `${dir}/**/*.test.{ts,tsx}`);

export default defineConfig({
  test: {
    // The tests run under Bun (`bun --bun vitest`, as in Speicherstadt/soll), so database tests use
    // bun:sqlite as the Zentrale does; Bun has no IPC channel for vitest's forks, threads work
    pool: "threads",
    projects: [
      {
        test: {
          name: "logic",
          include: tests(logic),
          exclude: ["**/*.agent.test.ts", "**/node_modules/**"],
        },
      },
      {
        plugins: [solid()],
        resolve: { conditions: ["development", "browser"] },
        test: {
          name: "interface",
          include: tests(interfaces),
          environment: "happy-dom",
          setupFiles: ["./vitest.solid-diagnostics.ts"],
          // The router ships its Solid source as JSX; inlined, the Solid plugin compiles it instead of
          // Vite's default JSX (React)
          server: { deps: { inline: [/@tanstack\/solid-router/] } },
        },
      },
    ],
  },
});

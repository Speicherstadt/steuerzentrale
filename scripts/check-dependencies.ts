/** `bun run lint`: fails when a workspace has a runtime dependency allowed-dependencies.json does not cover */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Allowlist,
  overrideViolations,
  violations,
  type Workspace,
} from "./allowed-dependencies.ts";
import { workspaceDirs } from "./workspaces.ts";

const root = process.cwd();
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"));

// Every kind of dependency Bun installs for a workspace ends up beside its code
const RUNTIME_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;
type Manifest = Partial<Record<(typeof RUNTIME_FIELDS)[number], Record<string, string>>>;

const workspaces: Workspace[] = workspaceDirs(root).map((dir) => {
  const manifest = readJson(`${dir}/package.json`) as Manifest;
  return {
    dir,
    // Entries, not a merged map: each field must pass on its own
    dependencies: RUNTIME_FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {})),
  };
});
const problems = [
  ...violations(readJson("allowed-dependencies.json") as Allowlist, workspaces),
  ...overrideViolations(readJson("package.json") as Record<string, unknown>),
];
for (const problem of problems) console.error(problem);
process.exit(problems.length > 0 ? 1 : 0);

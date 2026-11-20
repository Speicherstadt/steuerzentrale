/**
 * Builds every workspace that has a "build" script, in workspace order.
 * `bun run --filter` fails when no workspace exists yet; this runs green on an empty repository too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceDirs } from "./workspaces.ts";

const hasBuild = (dir: string): boolean =>
  Boolean(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts?.build);

const build = (dir: string): number =>
  Bun.spawnSync(["bun", "run", "build"], { cwd: dir, stdout: "inherit", stderr: "inherit" })
    .exitCode;

const failed = workspaceDirs(process.cwd())
  .filter(hasBuild)
  .filter((dir) => build(dir) !== 0);
if (failed.length > 0) {
  console.error(`Build failed in: ${failed.join(", ")}`);
  process.exit(1);
}

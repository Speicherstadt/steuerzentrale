import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import vitestConfig from "../vitest.config.ts";
import { parseJsonc, referencedPaths, workspaceDirs } from "./workspaces.ts";

// CI checks every workspace only if each one takes part in the type check and the test run.
// Source: Speicherstadt/kennwort, scripts/workspaces.test.ts.
const root = join(import.meta.dirname, "..");
const workspaces = workspaceDirs(root);
const projectIncludes = (vitestConfig.test?.projects ?? []).flatMap(
  (project) => (project as { test?: { include?: string[] } }).test?.include ?? [],
);
const solution = parseJsonc(readFileSync(join(root, "tsconfig.json"), "utf8"));

describe("workspaces", () => {
  it("are type-checked by tsc -b and covered by a Vitest project", () => {
    for (const dir of workspaces) {
      expect(existsSync(join(root, dir, "tsconfig.json")), `${dir}/tsconfig.json`).toBe(true);
      expect(referencedPaths(solution), `tsconfig.json references ${dir}`).toContain(dir);
      expect(
        projectIncludes.some((glob) => glob.startsWith(`${dir}/`)),
        `vitest.config.ts covers ${dir}`,
      ).toBe(true);
    }
  });

  it("scripts take part in the type check", () => {
    expect(referencedPaths(solution)).toContain("scripts");
  });
});

describe("parseJsonc", () => {
  it("reads line comments and trailing commas", () => {
    expect(parseJsonc('{\n  // note\n  "a": [1, 2,],\n}')).toEqual({ a: [1, 2] });
  });

  it("keeps strings that look like comments or trailing commas", () => {
    expect(parseJsonc('{"a": "x,]", "b": "http://x", "c": "/* y */"}')).toEqual({
      a: "x,]",
      b: "http://x",
      c: "/* y */",
    });
  });
});

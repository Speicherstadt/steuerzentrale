import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Allowlist, overrideViolations, violations } from "./allowed-dependencies.ts";

const allowlist: Allowlist = {
  packages: {
    zod: { reason: "schemas", workspaces: ["packages/manifest"] },
    hono: { reason: "", workspaces: ["apps/zentrale"] },
  },
};

describe("violations", () => {
  it("lets a listed package through in a listed workspace", () => {
    expect(
      violations(allowlist, [{ dir: "packages/manifest", dependencies: { zod: "4.6.7" } }]),
    ).toEqual([]);
  });

  it("fails a package that is not on the list", () => {
    expect(
      violations(allowlist, [{ dir: "apps/agent", dependencies: { "left-pad": "1.3.0" } }]),
    ).toEqual(["apps/agent: left-pad is not in allowed-dependencies.json"]);
  });

  it("fails a listed package in a workspace not named for it", () => {
    expect(violations(allowlist, [{ dir: "apps/agent", dependencies: { zod: "4.6.7" } }])).toEqual([
      "apps/agent: zod is allowed only in packages/manifest",
    ]);
  });

  it("fails an entry without a reason", () => {
    expect(
      violations(allowlist, [{ dir: "apps/zentrale", dependencies: { hono: "5.0.0" } }]),
    ).toEqual(["apps/zentrale: hono has no reason in allowed-dependencies.json"]);
  });

  it("fails ranges, aliases and Git sources", () => {
    const dependencies: [string, string][] = [
      ["zod", "^4.6.7"],
      ["zod", "npm:evil@1.0.0"],
      ["zod", "github:someone/zod"],
    ];
    expect(violations(allowlist, [{ dir: "packages/manifest", dependencies }])).toHaveLength(3);
  });

  it("needs no entry for a workspace package", () => {
    const dependencies = { "@steuerzentrale/manifest": "workspace:*" };
    expect(violations(allowlist, [{ dir: "apps/agent", dependencies }])).toEqual([]);
  });
});

describe("overrideViolations", () => {
  it("passes exact versions and fails ranges", () => {
    expect(overrideViolations({ overrides: { a: "1.2.3", b: "^1.0.0" } })).toEqual([
      'package.json: overrides b@"^1.0.0" is not an exact registry version',
    ]);
  });
});

describe("allowed-dependencies.json", () => {
  const root = join(import.meta.dirname, "..");
  const list = JSON.parse(
    readFileSync(join(root, "allowed-dependencies.json"), "utf8"),
  ) as Allowlist;

  it.each(Object.entries(list.packages))(
    "%s has a reason and at least one workspace",
    (_, entry) => {
      expect(entry.reason.trim()).not.toBe("");
      expect(entry.workspaces.length).toBeGreaterThan(0);
    },
  );

  it("is part of the lint script", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.lint).toContain("scripts/check-dependencies.ts");
  });
});

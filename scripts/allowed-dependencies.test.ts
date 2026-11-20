import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Allowlist,
  forbiddenViolations,
  overrideViolations,
  violations,
} from "./allowed-dependencies.ts";

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

describe("major versions", () => {
  const pinned: Allowlist = {
    packages: {
      "@tanstack/solid-router": { reason: "Solid 2 line", workspaces: ["apps/web"], major: 2 },
    },
  };

  it("lets the pinned major through, also as a release candidate", () => {
    const dependencies = { "@tanstack/solid-router": "2.0.0-rc.11" };
    expect(violations(pinned, [{ dir: "apps/web", dependencies }])).toEqual([]);
  });

  it("fails npm's latest from the Solid 1 line", () => {
    const dependencies = { "@tanstack/solid-router": "1.170.43" };
    expect(violations(pinned, [{ dir: "apps/web", dependencies }])).toEqual([
      "apps/web: @tanstack/solid-router@1.170.43 is not major 2 (allowed-dependencies.json: Solid 2 line)",
    ]);
  });
});

describe("forbiddenViolations", () => {
  const list: Allowlist = { packages: {}, forbidden: { "lucide-solid": "Solid 1 only" } };

  it("fails a forbidden package in any field, dev dependencies and root included", () => {
    expect(
      forbiddenViolations(list, [
        { dir: ".", names: ["lucide-solid"] },
        { dir: "packages/ui", names: ["lucide"] },
      ]),
    ).toEqual([".: lucide-solid is forbidden (Solid 1 only)"]);
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

  it("pins the major of Solid and of the TanStack packages built for Solid 2", () => {
    expect(list.packages["solid-js"]?.major).toBe(2);
    expect(list.packages["@solidjs/web"]?.major).toBe(2);
    expect(list.packages["@tanstack/solid-router"]?.major).toBe(2);
    expect(list.packages["@tanstack/solid-query"]?.major).toBe(6);
  });

  it("forbids the Solid 1 packages with a reason", () => {
    for (const name of ["lucide-solid", "vite-plugin-solid"])
      expect(list.forbidden?.[name]?.trim(), name).toBeTruthy();
  });

  it("is part of the lint script", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.lint).toContain("scripts/check-dependencies.ts");
  });
});

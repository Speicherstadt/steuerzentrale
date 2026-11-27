import { describe, expect, it } from "vitest";
import { run } from "./pruefen.ts";
import { checkSignOff, checkTicked, hints, itemOf } from "./regel.ts";

const signed = "Signed-off-by: Jana Beispiel <jana@example.com>";

describe("itemOf", () => {
  it("finds the Bauliste item", () => {
    expect(itemOf("Z-205: Quadlets rendern")).toBe("Z-205");
    expect(itemOf("Z-1004: Release")).toBe("Z-1004");
    expect(itemOf("Doku: Manifest")).toBeUndefined();
    expect(itemOf("Z-205 Quadlets rendern")).toBeUndefined();
  });
});

describe("checkSignOff", () => {
  it("passes a signed commit and fails an unsigned one", () => {
    const reports = checkSignOff([
      { subject: "feat: a", body: `text\n\n${signed}` },
      { subject: "fix: b", body: "no sign-off" },
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toContain("fix: b");
  });
});

describe("checkTicked", () => {
  const diff =
    "@@ -1 +1 @@\n-- [ ] **Z-205 Quadlets rendern** – …\n+- [x] **Z-205 Quadlets rendern** – …";

  it("passes when the item is ticked", () => {
    expect(checkTicked("Z-205", false, diff)).toEqual([]);
  });

  it("fails a ready pull request that does not tick its item", () => {
    expect(checkTicked("Z-205", false, "")).toHaveLength(1);
    expect(checkTicked("Z-206", false, diff)).toHaveLength(1);
  });

  it("waits while the pull request is a draft", () => {
    expect(checkTicked("Z-205", true, "")).toEqual([]);
  });
});

describe("hints", () => {
  it("warns about a schema change without docs/manifest.md", () => {
    const reports = hints(["packages/manifest/src/schema.ts", "docs/plan.md"]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toContain("docs/manifest.md");
  });

  it("stays quiet when docs/manifest.md changes with it, and for other code", () => {
    expect(hints(["packages/manifest/src/schema.ts", "docs/manifest.md"])).toEqual([]);
    expect(hints(["apps/agent/src/jobs.ts"])).toEqual([]);
  });
});

describe("run", () => {
  it("combines sign-off, tick and hints from git output", () => {
    const event = {
      pull_request: {
        title: "Z-205: Quadlets rendern",
        draft: false,
        base: { sha: "a" },
        head: { sha: "b" },
      },
    };
    const read = (args: string[]) =>
      args[0] === "log"
        ? `feat: render\n\n${signed}\u001e`
        : args.includes("--name-only")
          ? "BAULISTE.md\npackages/manifest/src/x.ts\ndocs/manifest.md\n"
          : "+- [x] **Z-205 Quadlets rendern** – …\n";
    expect(run(event, read)).toEqual([]);
  });
});

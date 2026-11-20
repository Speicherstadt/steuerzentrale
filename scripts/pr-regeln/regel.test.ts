import { describe, expect, it } from "vitest";
import { run } from "./pruefen.ts";
import { checkSignOff, checkTicked, checkTitle, hints, itemOf } from "./regel.ts";

const signed = "Signed-off-by: Jana Beispiel <jana@example.com>";

describe("checkTitle", () => {
  it.each([
    "Z-205: Quadlets rendern",
    "Z-1004: Release",
    "Doku: Manifest-Felder erklärt",
    "CI: Podman-Job",
  ])("passes %s", (title) => {
    expect(checkTitle(title)).toEqual([]);
  });

  it.each([
    "feat: quadlets",
    "Quadlets rendern",
    "Z-205 Quadlets rendern",
    "Z-205: Quadlets rendern.",
  ])("fails %s", (title) => {
    expect(checkTitle(title)).toHaveLength(1);
  });

  it("finds the Bauliste item", () => {
    expect(itemOf("Z-205: Quadlets rendern")).toBe("Z-205");
    expect(itemOf("Doku: Manifest")).toBeUndefined();
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
  it("warns about code without docs and a fix without a test", () => {
    const reports = hints(["apps/agent/src/jobs.ts"], ["fix: retry"]);
    expect(reports.map((report) => report.level)).toEqual(["warning", "warning"]);
  });

  it("warns about a schema change without docs/manifest.md", () => {
    const reports = hints(["packages/manifest/src/schema.ts", "docs/plan.md"], ["feat: field"]);
    expect(reports.map((report) => report.message).join()).toContain("docs/manifest.md");
  });

  it("stays quiet for tests and docs", () => {
    expect(hints(["apps/agent/src/jobs.test.ts", "docs/plan.md"], ["test: retry"])).toEqual([]);
  });
});

describe("run", () => {
  it("combines title, sign-off and tick from git output", () => {
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

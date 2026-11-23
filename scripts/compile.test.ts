import { describe, expect, it } from "vitest";
import { bauVersion, compileArgs, TARGETS } from "./compile.ts";

describe("compile", () => {
  it("builds for both server architectures", () => {
    expect([...TARGETS]).toEqual(["linux-x64", "linux-arm64"]);
  });

  it("names the binary after its target", () => {
    const args = compileArgs("src/main.ts", "dist/agent", "linux-arm64");
    expect(args).toContain("--target=bun-linux-arm64");
    expect(args.at(-1)).toBe("dist/agent-linux-arm64");
    expect(args).not.toContain("--define");
  });

  // CI builds a newer agent for the test of the agent's update (BAULISTE.md Z-504)
  it("names another version only when STEUERZENTRALE_BAU_VERSION is set, in its form", () => {
    expect(bauVersion({})).toBeUndefined();
    expect(bauVersion({ STEUERZENTRALE_BAU_VERSION: "0.0.1" })).toBe("0.0.1");
    expect(() => bauVersion({ STEUERZENTRALE_BAU_VERSION: '0.0.1"; x' })).toThrow();
    const args = compileArgs("src/main.ts", "dist/agent", "linux-x64", "0.0.1");
    expect(args).toContain('STEUERZENTRALE_BAU_VERSION="0.0.1"');
  });
});

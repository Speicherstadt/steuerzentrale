import { describe, expect, it } from "vitest";
import { compileArgs, TARGETS } from "./compile.ts";

describe("compile", () => {
  it("builds for both server architectures", () => {
    expect([...TARGETS]).toEqual(["linux-x64", "linux-arm64"]);
  });

  it("names the binary after its target", () => {
    const args = compileArgs("src/main.ts", "dist/agent", "linux-arm64");
    expect(args).toContain("--target=bun-linux-arm64");
    expect(args.at(-1)).toBe("dist/agent-linux-arm64");
  });
});

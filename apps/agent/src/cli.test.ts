import { PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { runCli, versionLine } from "./cli.ts";

describe("agent command line", () => {
  it("prints version and protocol", () => {
    expect(versionLine()).toBe(`steuerzentrale-agent ${VERSION} (protokoll ${PROTOKOLL_VERSION})`);
    expect(runCli(["--version"])).toEqual({ code: 0, out: versionLine() });
  });

  it("refuses anything else with the usage", () => {
    expect(runCli(["sh", "-c", "id"]).code).toBe(2);
  });
});

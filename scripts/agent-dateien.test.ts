import { describe, expect, it } from "vitest";
import { versionAusZeile } from "./agent-dateien.ts";

// VERSION in the agent files names what the binaries print, which the Zentrale updates to (Z-504)
describe("agent files", () => {
  it("read the version from the line of --version", () => {
    expect(versionAusZeile("steuerzentrale-agent 0.0.1 (protokoll 1)\n")).toBe("0.0.1");
    expect(versionAusZeile("steuerzentrale-agent 1.2.0-rc.1 (protokoll 2)")).toBe("1.2.0-rc.1");
    expect(versionAusZeile("usage: steuerzentrale-agent --version")).toBeUndefined();
  });
});

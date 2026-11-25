import { describe, expect, it } from "vitest";
import { AGENT_UPDATE_AKTION } from "./agent-update.ts";
import { AUFTRAGS_ARTEN, imBeobachtenErlaubt } from "./beobachten.ts";

describe("imBeobachtenErlaubt (Z-1102)", () => {
  it("allows the update of the agent", () => {
    expect(imBeobachtenErlaubt(AGENT_UPDATE_AKTION)).toBe(true);
  });

  // every built-in kind and a command of an app's manifest (packages/manifest/test/auftrag.yml)
  it.each([...AUFTRAGS_ARTEN.filter((a) => a !== AGENT_UPDATE_AKTION), "migrieren"])(
    "refuses %s",
    (aktion) => {
      expect(imBeobachtenErlaubt(aktion)).toBe(false);
    },
  );

  it("knows sixteen kinds of job", () => {
    expect(new Set(AUFTRAGS_ARTEN).size).toBe(AUFTRAGS_ARTEN.length);
    expect(AUFTRAGS_ARTEN.length).toBe(16);
  });
});

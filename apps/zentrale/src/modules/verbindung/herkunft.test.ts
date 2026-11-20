import { describe, expect, it } from "vitest";
import { agentFingerabdruck } from "./herkunft.ts";

const FP = "a0bf7f807dda6a86c40538f5c8599d3c40b4be8e6fd682691826d73b063b98af";
const MIT_DOPPELPUNKTEN = FP.toUpperCase().match(/../g)?.join(":") ?? "";

describe("agentFingerabdruck", () => {
  it("takes the header from the loopback address, where the Pforte runs", () => {
    expect(agentFingerabdruck("127.0.0.1", FP)).toBe(FP);
    expect(agentFingerabdruck("::1", FP)).toBe(FP);
    expect(agentFingerabdruck("::ffff:127.0.0.1", MIT_DOPPELPUNKTEN)).toBe(FP);
  });

  it("ignores the header from anywhere else: a client cannot claim a certificate", () => {
    expect(agentFingerabdruck("203.0.113.9", FP)).toBeUndefined();
    expect(agentFingerabdruck("10.0.0.2", FP)).toBeUndefined();
    expect(agentFingerabdruck(undefined, FP)).toBeUndefined();
  });

  it("refuses what is no SHA-256", () => {
    for (const kopf of [null, "", "abc", `${FP}00`, FP.replace("a", "g"), `${FP},${FP}`])
      expect(agentFingerabdruck("127.0.0.1", kopf), String(kopf)).toBeUndefined();
  });
});

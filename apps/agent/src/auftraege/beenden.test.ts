import { describe, expect, it } from "vitest";
import { traegt } from "./beenden.ts";

/*
 * Only a process whose environment holds the run's entry exactly is killed: never one whose mark
 * starts like it, nor one that has the value under another name.
 */
describe("traegt", () => {
  const eintrag = "STEUERZENTRALE_LAUF=7a56edf8-d30a-4ee6-9415-dbf11fc63dec";

  it("finds the entry among the others", () => {
    expect(traegt(`PATH=/usr/bin\0${eintrag}\0HOME=/`, eintrag)).toBe(true);
    expect(traegt(`${eintrag}\0`, eintrag)).toBe(true);
  });

  it("does not take a longer value, another name or an empty environment for it", () => {
    expect(traegt(`${eintrag}0\0`, eintrag)).toBe(false);
    expect(traegt(`X${eintrag}\0`, eintrag)).toBe(false);
    expect(traegt(`ANDERS=${eintrag.split("=")[1]}\0`, eintrag)).toBe(false);
    expect(traegt("", eintrag)).toBe(false);
  });
});

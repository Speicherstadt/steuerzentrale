import { describe, expect, it } from "vitest";
import { testQuellen } from "./testquellen.ts";
import { UHR_SYNCHRON, uhrSynchron } from "./uhr.ts";

// `timedatectl show --property=NTPSynchronized --value` prints `yes` or `no` (systemd 255 and 257)
const mit = (code: number, aus: string) =>
  testQuellen({ befehle: { [UHR_SYNCHRON.join(" ")]: { code, aus } } });

describe("time service (Z-702)", () => {
  it("asks timedatectl with a fixed argv", () => {
    expect(UHR_SYNCHRON).toEqual(["timedatectl", "show", "--property=NTPSynchronized", "--value"]);
  });

  it("reads yes and no", async () => {
    expect(await uhrSynchron(mit(0, "yes\n"))).toBe(true);
    expect(await uhrSynchron(mit(0, "no\n"))).toBe(false);
  });

  it("is null without timedatectl, on an error or with output it does not know", async () => {
    expect(await uhrSynchron(testQuellen())).toBeNull();
    expect(await uhrSynchron(mit(1, "yes\n"))).toBeNull();
    expect(await uhrSynchron(mit(0, "vielleicht\n"))).toBeNull();
  });
});

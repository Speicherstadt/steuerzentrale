import { describe, expect, it } from "vitest";
import {
  APT_CONFIG,
  BOOT_ID_DATEI,
  bootIdLesen,
  gestartetAm,
  UNATTENDED_BINARY,
  UNATTENDED_STEMPEL,
  unattendedUpgrades,
} from "./betriebssystem.ts";
import { testQuellen } from "./testquellen.ts";

/*
 * BAULISTE.md Z-701: what the agent reads of the operating system besides packages and the kernel:
 * the boot (its id and when it began) and unattended-upgrades (installed, on, last run).
 */
const BOOT = "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4";

// `apt-config dump` on Debian 13 with unattended-upgrades on (20auto-upgrades), shortened
const DUMP = [
  'APT "";',
  'APT::Architecture "amd64";',
  'APT::Periodic "";',
  'APT::Periodic::Update-Package-Lists "1";',
  'APT::Periodic::Unattended-Upgrade "1";',
  'Unattended-Upgrade::Origins-Pattern "";',
].join("\n");

describe("the boot", () => {
  it("reads the kernel's boot id", async () => {
    expect(await bootIdLesen(testQuellen({ dateien: { [BOOT_ID_DATEI]: `${BOOT}\n` } }))).toBe(
      BOOT,
    );
    expect(BOOT_ID_DATEI).toBe("/proc/sys/kernel/random/boot_id");
  });

  it("is null when the file is missing or holds no boot id", async () => {
    expect(await bootIdLesen(testQuellen())).toBeNull();
    expect(await bootIdLesen(testQuellen({ dateien: { [BOOT_ID_DATEI]: "kaputt\n" } }))).toBeNull();
  });

  it("began at btime of /proc/stat, in milliseconds", async () => {
    const stat = "cpu  1 2 3\nintr 5\nctxt 6\nbtime 1794900000\nprocesses 7\n";
    expect(await gestartetAm(testQuellen({ dateien: { "/proc/stat": stat } }))).toBe(
      1_794_900_000_000,
    );
    expect(await gestartetAm(testQuellen({ dateien: { "/proc/stat": "cpu 1\n" } }))).toBeNull();
    expect(await gestartetAm(testQuellen())).toBeNull();
  });
});

describe("unattended-upgrades", () => {
  it("is installed, on and ran when its stamp was last touched", async () => {
    const q = testQuellen({
      dateien: { [UNATTENDED_BINARY]: "" },
      befehle: { [APT_CONFIG.join(" ")]: { code: 0, aus: DUMP } },
      zeiten: { [UNATTENDED_STEMPEL]: 1_794_990_000_000 },
    });
    expect(await unattendedUpgrades(q)).toEqual({
      installiert: true,
      aktiv: true,
      letzterLauf: 1_794_990_000_000,
    });
    expect(q.aufrufe).toEqual([["apt-config", "dump"]]);
  });

  it("is off when apt's setting is 0 or missing, and unknown when apt-config fails", async () => {
    const mit = (aus: string, code = 0) =>
      unattendedUpgrades(
        testQuellen({
          dateien: { [UNATTENDED_BINARY]: "" },
          befehle: { [APT_CONFIG.join(" ")]: { code, aus } },
        }),
      );
    expect(await mit(DUMP.replace('Upgrade "1"', 'Upgrade "0"'))).toMatchObject({ aktiv: false });
    expect(await mit('APT "";')).toMatchObject({ aktiv: false, letzterLauf: null });
    expect(await mit(DUMP, 100)).toMatchObject({ installiert: true, aktiv: null });
  });

  it("is not installed without its program, and then never asks apt", async () => {
    const q = testQuellen({ befehle: { [APT_CONFIG.join(" ")]: { code: 0, aus: DUMP } } });
    expect(await unattendedUpgrades(q)).toEqual({
      installiert: false,
      aktiv: false,
      letzterLauf: null,
    });
    expect(q.aufrufe).toEqual([]);
  });
});

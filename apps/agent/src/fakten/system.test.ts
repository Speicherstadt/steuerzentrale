import { describe, expect, it } from "vitest";
import {
  architektur,
  cpuKerne,
  kernel,
  neuesterKernel,
  neustartNoetig,
  osLesen,
  ramMb,
} from "./system.ts";
import { testQuellen } from "./testquellen.ts";

// /proc/cpuinfo and /proc/meminfo as Linux 6.12 writes them (proc(5)), shortened
const CPUINFO_AMD64 = [
  "processor\t: 0",
  "vendor_id\t: AuthenticAMD",
  "model name\t: AMD EPYC 9634 84-Core Processor",
  "",
  "processor\t: 1",
  "vendor_id\t: AuthenticAMD",
  "",
].join("\n");
const CPUINFO_ARM64 = [
  "processor\t: 0",
  "BogoMIPS\t: 50.00",
  "",
  "processor\t: 1",
  "",
  "processor\t: 2",
  "",
  "processor\t: 3",
  "",
].join("\n");
const MEMINFO = "MemTotal:        8131592 kB\nMemFree:         1234567 kB\n";

// /etc/os-release of debian:13 and ubuntu:24.04 (os-release(5))
const DEBIAN_13 = [
  'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"',
  'NAME="Debian GNU/Linux"',
  'VERSION_ID="13"',
  'VERSION="13 (trixie)"',
  "ID=debian",
].join("\n");
const UBUNTU_2404 = [
  'PRETTY_NAME="Ubuntu 24.04.3 LTS"',
  'NAME="Ubuntu"',
  'VERSION_ID="24.04"',
  "ID=ubuntu",
].join("\n");

describe("CPU cores and RAM", () => {
  it("counts the processors of /proc/cpuinfo on amd64 and arm64", async () => {
    expect(await cpuKerne(testQuellen({ dateien: { "/proc/cpuinfo": CPUINFO_AMD64 } }))).toBe(2);
    expect(await cpuKerne(testQuellen({ dateien: { "/proc/cpuinfo": CPUINFO_ARM64 } }))).toBe(4);
  });

  it("reads MemTotal in MiB", async () => {
    expect(await ramMb(testQuellen({ dateien: { "/proc/meminfo": MEMINFO } }))).toBe(7941);
  });

  it("is null when the file is missing or says nothing", async () => {
    expect(await cpuKerne(testQuellen())).toBeNull();
    expect(await cpuKerne(testQuellen({ dateien: { "/proc/cpuinfo": "flags: x\n" } }))).toBeNull();
    expect(await ramMb(testQuellen())).toBeNull();
    expect(await ramMb(testQuellen({ dateien: { "/proc/meminfo": "MemFree: 1 kB" } }))).toBeNull();
  });
});

describe("architecture", () => {
  it("maps uname's machine to the names of the manifests", () => {
    expect(architektur(testQuellen({ maschine: () => "x86_64" }))).toBe("amd64");
    expect(architektur(testQuellen({ maschine: () => "aarch64" }))).toBe("arm64");
    expect(architektur(testQuellen({ maschine: () => "riscv64" }))).toBeNull();
  });
});

describe("operating system", () => {
  it("reads NAME and VERSION_ID of /etc/os-release", async () => {
    expect(await osLesen(testQuellen({ dateien: { "/etc/os-release": DEBIAN_13 } }))).toEqual({
      name: "Debian GNU/Linux",
      version: "13",
    });
    expect(await osLesen(testQuellen({ dateien: { "/etc/os-release": UBUNTU_2404 } }))).toEqual({
      name: "Ubuntu",
      version: "24.04",
    });
  });

  it("falls back to /usr/lib/os-release, and is null without either", async () => {
    expect(
      await osLesen(
        testQuellen({ dateien: { "/usr/lib/os-release": "NAME=Debian\nVERSION_ID=13" } }),
      ),
    ).toEqual({ name: "Debian", version: "13" });
    expect(await osLesen(testQuellen())).toBeNull();
  });

  it("names an empty version for a rolling release without VERSION_ID", async () => {
    expect(
      await osLesen(testQuellen({ dateien: { "/etc/os-release": 'NAME="Debian GNU/Linux"' } })),
    ).toEqual({ name: "Debian GNU/Linux", version: "" });
  });
});

describe("kernel", () => {
  it("finds the newest installed kernel by its version, not its spelling", () => {
    expect(
      neuesterKernel([
        "config-6.12.9+deb13-amd64",
        "vmlinuz-6.12.9+deb13-amd64",
        "vmlinuz-6.12.48+deb13-amd64",
        "System.map-6.12.48+deb13-amd64",
        "initrd.img-6.12.48+deb13-amd64",
      ]),
    ).toBe("6.12.48+deb13-amd64");
    expect(neuesterKernel(["vmlinuz", "efi"])).toBeNull();
  });

  it("reads the running kernel and the newest in /boot, else in /lib/modules", async () => {
    const laeuft = { "/proc/sys/kernel/osrelease": "6.12.41+deb13-amd64\n" };
    expect(
      await kernel(
        testQuellen({
          dateien: laeuft,
          ordner: { "/boot": ["vmlinuz-6.12.41+deb13-amd64", "vmlinuz-6.12.48+deb13-amd64"] },
        }),
      ),
    ).toEqual({ laeuft: "6.12.41+deb13-amd64", installiert: "6.12.48+deb13-amd64" });
    expect(
      await kernel(
        testQuellen({
          dateien: laeuft,
          ordner: { "/boot": [], "/lib/modules": ["6.8.0-48-generic", "6.8.0-51-generic"] },
        }),
      ),
    ).toEqual({ laeuft: "6.12.41+deb13-amd64", installiert: "6.8.0-51-generic" });
  });

  it("is null for what it cannot read (a container has no kernel of its own)", async () => {
    expect(await kernel(testQuellen())).toEqual({ laeuft: null, installiert: null });
  });
});

describe("reboot needed", () => {
  const kernelDateien = (laeuft: string) => ({ "/proc/sys/kernel/osrelease": laeuft });

  it("is true when /var/run/reboot-required exists", async () => {
    const q = testQuellen({
      dateien: { "/var/run/reboot-required": "*** System restart required ***\n" },
    });
    expect(await neustartNoetig(q, { laeuft: "6.12.48", installiert: "6.12.48" })).toBe(true);
  });

  it("is true when a newer kernel is installed than runs, as Debian writes no such file", async () => {
    const q = testQuellen({ dateien: kernelDateien("6.12.41") });
    expect(await neustartNoetig(q, { laeuft: "6.12.41", installiert: "6.12.48" })).toBe(true);
    expect(await neustartNoetig(q, { laeuft: "6.12.48", installiert: "6.12.48" })).toBe(false);
    expect(await neustartNoetig(q, { laeuft: "6.12.48", installiert: null })).toBe(false);
  });

  it("is false after booting a newer kernel than the newest one left installed", async () => {
    const q = testQuellen();
    expect(await neustartNoetig(q, { laeuft: "6.12.48", installiert: "6.12.41" })).toBe(false);
  });
});

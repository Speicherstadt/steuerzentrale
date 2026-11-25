import { describe, expect, it } from "vitest";
import {
  cpuProzent,
  cpuZaehlerLesen,
  lastLesen,
  lastMesser,
  ramBelegtMb,
  speicherMb,
  usageUsec,
} from "./last.ts";
import type { FaktenQuellen } from "./quellen.ts";

/*
 * BAULISTE.md Z-1106: the values from fixed sample files (proc(5), cgroup v2), also on the first
 * reading without a previous one and after a reboot; an unreadable file is unknown, never 0.
 */

const STAT_1 = "cpu  1000 0 500 8000 500 0 0 0 0 0\ncpu0 500 0 250 4000 250 0 0 0 0 0\n";
// 1000 jiffies later: 300 busy (200 user, 100 system), 700 idle and iowait
const STAT_2 = "cpu  1200 0 600 8600 600 0 0 0 0 0\ncpu0 600 0 300 4300 300 0 0 0 0 0\n";
// after a reboot the counters start at 0 again
const STAT_NEU = "cpu  10 0 5 80 5 0 0 0 0 0\n";
const MEMINFO =
  "MemTotal:        8000000 kB\nMemFree:          500000 kB\nMemAvailable:    2000000 kB\n";

describe("the server's values", () => {
  it("reads busy and idle jiffies and the share between two readings", () => {
    const a = cpuZaehlerLesen(STAT_1);
    const b = cpuZaehlerLesen(STAT_2);
    expect(a).toEqual({ gesamt: 10_000, leerlauf: 8_500 });
    expect(cpuProzent(a, b)).toBe(30);
  });

  it("has no CPU value on the first reading nor after a reboot, and never 0 for it", () => {
    expect(cpuProzent(null, cpuZaehlerLesen(STAT_1))).toBeNull();
    expect(cpuProzent(cpuZaehlerLesen(STAT_2), cpuZaehlerLesen(STAT_NEU))).toBeNull();
  });

  it("reads load and memory in use", () => {
    expect(lastLesen("0.42 0.30 0.25 1/123 4567\n")).toBe(0.42);
    expect(ramBelegtMb(MEMINFO)).toBe(5859);
  });

  it.each([undefined, "", "keine zahl"])("knows nothing from %j, never 0", (text) => {
    expect(cpuZaehlerLesen(text)).toBeNull();
    expect(lastLesen(text)).toBeNull();
    expect(ramBelegtMb(text)).toBeNull();
    expect(usageUsec(text)).toBeNull();
    expect(speicherMb(text)).toBeNull();
  });

  it("refuses memory without MemAvailable", () => {
    expect(ramBelegtMb("MemTotal: 8000000 kB\n")).toBeNull();
  });
});

const quellen = (dateien: Record<string, string>): FaktenQuellen =>
  ({ lesen: async (p: string) => dateien[p] }) as unknown as FaktenQuellen;

describe("lastMesser", () => {
  it("reads each installation's user from its cgroup, CPU from the second reading on", async () => {
    const slice = "/sys/fs/cgroup/user.slice/user-1001.slice";
    const dateien: Record<string, string> = {
      "/proc/stat": STAT_1,
      "/proc/loadavg": "1.50 1.0 0.5 2/200 99\n",
      "/proc/meminfo": MEMINFO,
      [`${slice}/cpu.stat`]: "usage_usec 1000000\nuser_usec 800000\n",
      [`${slice}/memory.current`]: String(512 * 1024 * 1024),
    };
    const messen = lastMesser(quellen(dateien));
    const nutzer = [
      { name: "sz-haben", uid: 1001 },
      { name: "sz-weg", uid: 1002 },
    ];
    expect(await messen(nutzer, 2, 0)).toEqual({
      cpuProzent: null,
      last1: 1.5,
      ramBelegtMb: 5859,
      nutzer: [
        { name: "sz-haben", cpuProzent: null, ramMb: 512 },
        { name: "sz-weg", cpuProzent: null, ramMb: null },
      ],
    });
    dateien["/proc/stat"] = STAT_2;
    // 60 s later, 30 s of CPU time on 2 cores: a quarter of the machine
    dateien[`${slice}/cpu.stat`] = "usage_usec 31000000\n";
    dateien[`${slice}/memory.current`] = String(768 * 1024 * 1024);
    const zweite = await messen(nutzer, 2, 60_000);
    expect(zweite.cpuProzent).toBe(30);
    expect(zweite.nutzer).toEqual([
      { name: "sz-haben", cpuProzent: 25, ramMb: 768 },
      { name: "sz-weg", cpuProzent: null, ramMb: null },
    ]);
  });
});

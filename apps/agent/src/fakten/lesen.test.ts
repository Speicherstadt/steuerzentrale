import { Fakten } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { faktenLesen, uhrAbweichung } from "./lesen.ts";
import { testQuellen } from "./testquellen.ts";

describe("all facts", () => {
  it("are a valid message even when nothing is readable, with null for every fact", async () => {
    const n = await faktenLesen(testQuellen(), { jetzt: 5, uhrzeitAbweichungMs: null });
    expect(Fakten.parse(n)).toEqual(n);
    expect(n).toMatchObject({
      typ: "fakten",
      zeit: 5,
      cpuKerne: null,
      ramMb: null,
      platten: null,
      architektur: null,
      os: null,
      kernel: { laeuft: null, installiert: null },
      neustartNoetig: false,
      updatesAusstehend: null,
      podman: null,
      ipv4: [],
      ipv6: [],
      ptr: {},
      portsBelegt: null,
      port25Ausgehend: null,
      uhrzeitAbweichungMs: null,
      bootId: null,
      gestartetAm: null,
      unattendedUpgrades: { installiert: false, aktiv: false, letzterLauf: null },
    });
  });

  it("put each fact where the message names it", async () => {
    const q = testQuellen({
      dateien: {
        "/proc/cpuinfo": "processor\t: 0\n",
        "/proc/meminfo": "MemTotal: 2097152 kB\n",
        "/etc/os-release": 'NAME="Debian GNU/Linux"\nVERSION_ID="13"\n',
        "/proc/mounts": "/dev/sda1 / ext4 rw 0 0\n",
        "/proc/net/tcp": "kopf\n 0: 00000000:0016 00000000:0000 0A x\n",
        "/proc/sys/kernel/random/boot_id": "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4\n",
        "/proc/stat": "btime 1794900000\n",
      },
      befehle: { "podman --version": { code: 0, aus: "podman version 5.4.2" } },
      maschine: () => "aarch64",
      platz: async () => ({ gesamtMb: 10, freiMb: 4 }),
      verbinden: async () => false,
    });
    expect(await faktenLesen(q, { jetzt: 1, uhrzeitAbweichungMs: -40 })).toMatchObject({
      cpuKerne: 1,
      ramMb: 2048,
      architektur: "arm64",
      os: { name: "Debian GNU/Linux", version: "13" },
      platten: [{ mount: "/", gesamtMb: 10, freiMb: 4 }],
      portsBelegt: [{ port: 22, proto: "tcp" }],
      podman: "5.4.2",
      port25Ausgehend: false,
      uhrzeitAbweichungMs: -40,
      bootId: "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4",
      gestartetAm: 1_794_900_000_000,
    });
  });
});

describe("clock offset", () => {
  it("compares the agent's clock halfway between hallo and willkommen with the Zentrale's", () => {
    // sent at 1000, answered at 1200 by the agent's clock; the Zentrale said 1300 → 200 ms behind
    expect(uhrAbweichung({ gesendet: 1000, empfangen: 1200, zentrale: 1300 })).toBe(-200);
    expect(uhrAbweichung({ gesendet: 1000, empfangen: 1001, zentrale: 900 })).toBe(101);
  });
});

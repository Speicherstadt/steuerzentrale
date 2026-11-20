import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { adressen, istOeffentlich, PORT25_ZIEL, port25Ausgehend, ptrLesen } from "./netz.ts";
import { testQuellen } from "./testquellen.ts";

const v4 = (address: string, internal = false) =>
  ({ address, family: "IPv4", internal, netmask: "", mac: "", cidr: null }) as NetworkInterfaceInfo;
const v6 = (address: string, internal = false) =>
  ({
    address,
    family: "IPv6",
    internal,
    netmask: "",
    mac: "",
    cidr: null,
    scopeid: 0,
  }) as NetworkInterfaceInfo;

// os.networkInterfaces() of a server with a public address, WireGuard and rootful Podman's bridge
const SCHNITTSTELLEN = {
  lo: [v4("127.0.0.1", true), v6("::1", true)],
  eth0: [v4("203.0.113.10"), v6("2001:db8::10"), v6("fe80::1")],
  wg0: [v4("10.8.0.1")],
  podman0: [v4("10.88.0.1"), v6("fe80::2")],
  veth0: [v6("fe80::3")],
  eth1: [v4("169.254.10.2"), v4("203.0.113.10")],
};

describe("addresses", () => {
  it("names public and private addresses, not loopback, link-local or Podman's networks", () => {
    expect(adressen(testQuellen({ schnittstellen: () => SCHNITTSTELLEN }))).toEqual({
      ipv4: ["203.0.113.10", "10.8.0.1"],
      ipv6: ["2001:db8::10"],
    });
  });

  it("tells public from private", () => {
    for (const ip of ["203.0.113.10", "2001:db8::10", "8.8.8.8", "2a01:4f8::1"])
      expect(istOeffentlich(ip), ip).toBe(true);
    for (const ip of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.1",
      "192.168.1.1",
      "100.64.0.1",
      "127.0.0.1",
      "fd00::1",
      "fe80::1",
      "::1",
    ])
      expect(istOeffentlich(ip), ip).toBe(false);
  });
});

describe("PTR", () => {
  it("looks up the public addresses only and keeps the first name of each", async () => {
    const gefragt: string[] = [];
    const q = testQuellen({
      rueckwaerts: async (ip) => {
        gefragt.push(ip);
        return ip === "203.0.113.10" ? ["server-a.example.org", "alt.example.org"] : undefined;
      },
    });
    expect(await ptrLesen(q, ["203.0.113.10", "10.8.0.1", "2001:db8::10"])).toEqual({
      "203.0.113.10": "server-a.example.org",
    });
    expect(gefragt).toEqual(["203.0.113.10", "2001:db8::10"]);
  });
});

describe("outgoing port 25", () => {
  it("tries the fixed target with a short limit", async () => {
    const versuche: unknown[] = [];
    const q = testQuellen({
      verbinden: async (...args) => {
        versuche.push(args);
        return true;
      },
    });
    expect(await port25Ausgehend(q)).toBe(true);
    expect(versuche).toEqual([[PORT25_ZIEL, 25, 5000]]);
    expect(PORT25_ZIEL).toBe("gmail-smtp-in.l.google.com");
  });

  it("passes on blocked and unknown", async () => {
    expect(await port25Ausgehend(testQuellen({ verbinden: async () => false }))).toBe(false);
    expect(await port25Ausgehend(testQuellen({ verbinden: async () => null }))).toBeNull();
  });
});

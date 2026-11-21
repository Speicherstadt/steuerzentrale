import { describe, expect, it } from "vitest";
import { belegtePorts, portsAus } from "./ports.ts";
import { testQuellen } from "./testquellen.ts";

// /proc/net/tcp, tcp6 and udp in the layout of Linux 6.x (proc(5)): sshd on 22, Caddy on 80 and
// 443 over IPv6, one established connection from 22, a listener on 127.0.0.1:2019 (Caddy's admin
// API), and on UDP 443 (HTTP/3) plus a connected client socket
const KOPF =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const TCP = [
  KOPF,
  "   0: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1037 1 0000000000000000 100 0 0 10 0",
  "   1: 0100007F:07E3 00000000:0000 0A 00000000:00000000 00:00000000 00000000   990        0 4101 1 0000000000000000 100 0 0 10 0",
  "   2: 0A00000F:0016 0200080A:CB2C 01 00000000:00000000 02:000A7D9C 00000000     0        0 8812 4 0000000000000000 20 4 30 10 -1",
].join("\n");
const TCP6 = [
  KOPF,
  "   0: 00000000000000000000000000000000:0050 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000   991        0 5120 1 0000000000000000 100 0 0 10 0",
  "   1: 00000000000000000000000000000000:01BB 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000   991        0 5121 1 0000000000000000 100 0 0 10 0",
  "   2: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1039 1 0000000000000000 100 0 0 10 0",
].join("\n");
const UDP = [
  "   sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops",
  "  101: 00000000:01BB 00000000:0000 07 00000000:00000000 00:00000000 00000000   991        0 5130 2 0000000000000000 0",
  "  102: 0A00000F:D431 08080808:0035 01 00000000:00000000 00:00000000 00000000     0        0 5131 2 0000000000000000 0",
].join("\n");

describe("ports in use", () => {
  it("reads the listening TCP sockets and the unconnected UDP ones", () => {
    expect(portsAus(TCP, "tcp")).toEqual([22, 2019]);
    expect(portsAus(TCP6, "tcp")).toEqual([80, 443, 22]);
    expect(portsAus(UDP, "udp")).toEqual([443]);
  });

  it("joins IPv4 and IPv6, once per port and protocol, sorted", async () => {
    const q = testQuellen({
      dateien: { "/proc/net/tcp": TCP, "/proc/net/tcp6": TCP6, "/proc/net/udp": UDP },
    });
    expect(await belegtePorts(q)).toEqual([
      { port: 22, proto: "tcp" },
      { port: 80, proto: "tcp" },
      { port: 443, proto: "tcp" },
      { port: 443, proto: "udp" },
      { port: 2019, proto: "tcp" },
    ]);
  });

  it("reads a kernel without IPv6, and is null without /proc/net/tcp", async () => {
    expect(await belegtePorts(testQuellen({ dateien: { "/proc/net/tcp": TCP } }))).toEqual([
      { port: 22, proto: "tcp" },
      { port: 2019, proto: "tcp" },
    ]);
    expect(await belegtePorts(testQuellen())).toBeNull();
  });
});

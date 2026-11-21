import type { FaktenQuellen } from "./quellen.ts";

/*
 * The ports in use on the server (BAULISTE.md Z-304), from the kernel's socket tables in /proc/net
 * (proc(5)): TCP sockets in state LISTEN (0A) and UDP sockets not connected to anyone (state 07,
 * remote port 0). Placement checks an app's fixed ports against them.
 */

type Proto = "tcp" | "udp";

const ZUSTAND: Record<Proto, string> = { tcp: "0A", udp: "07" };

/** The local ports of the listening sockets in one table, in its order */
export const portsAus = (tabelle: string, proto: Proto): number[] =>
  tabelle
    .split("\n")
    .slice(1)
    .flatMap((zeile) => {
      const [, lokal, fern, zustand] = zeile.trim().split(/\s+/);
      if (zustand !== ZUSTAND[proto] || !lokal || !fern) return [];
      if (proto === "udp" && !fern.endsWith(":0000")) return [];
      const port = Number.parseInt(lokal.split(":")[1] ?? "", 16);
      return port > 0 && port <= 65535 ? [port] : [];
    });

const TABELLEN: [string, Proto][] = [
  ["/proc/net/tcp", "tcp"],
  ["/proc/net/tcp6", "tcp"],
  ["/proc/net/udp", "udp"],
  ["/proc/net/udp6", "udp"],
];

export const belegtePorts = async (
  q: FaktenQuellen,
): Promise<{ port: number; proto: Proto }[] | null> => {
  const gelesen = await Promise.all(
    TABELLEN.map(async ([pfad, proto]) => ({ text: await q.lesen(pfad), proto })),
  );
  if (gelesen[0]?.text === undefined) return null;
  const schluessel = new Set(
    gelesen.flatMap(({ text, proto }) =>
      text === undefined ? [] : portsAus(text, proto).map((port) => `${port}/${proto}`),
    ),
  );
  return [...schluessel]
    .map((s) => {
      const [port, proto] = s.split("/");
      return { port: Number(port), proto: proto as Proto };
    })
    .sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
};

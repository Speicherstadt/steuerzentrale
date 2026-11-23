import { FREMD } from "./netz.ts";
import type { FaktenQuellen } from "./quellen.ts";

/*
 * The ports in use on the server (BAULISTE.md Z-304), from the kernel's socket tables in /proc/net
 * (proc(5)): TCP sockets in state LISTEN (0A) and UDP sockets not connected to anyone (state 07,
 * remote port 0). Placement checks an app's fixed ports against them; the check of open ports
 * (Z-702) takes those reachable from the network.
 */

type Proto = "tcp" | "udp";
type Port = { port: number; proto: Proto };

const ZUSTAND: Record<Proto, string> = { tcp: "0A", udp: "07" };

/** The listening sockets in one table, in its order: local port and address as the kernel wrote */
const socketsAus = (tabelle: string, proto: Proto): { port: number; lokal: string }[] =>
  tabelle
    .split("\n")
    .slice(1)
    .flatMap((zeile) => {
      const [, lokal, fern, zustand] = zeile.trim().split(/\s+/);
      if (zustand !== ZUSTAND[proto] || !lokal || !fern) return [];
      if (proto === "udp" && !fern.endsWith(":0000")) return [];
      const [adresse = "", hex = ""] = lokal.split(":");
      const port = Number.parseInt(hex, 16);
      return port > 0 && port <= 65535 ? [{ port, lokal: adresse }] : [];
    });

/** The local ports of the listening sockets in one table, in its order */
export const portsAus = (tabelle: string, proto: Proto): number[] =>
  socketsAus(tabelle, proto).map((s) => s.port);

/** An IPv4 address the kernel writes as one 32-bit word in host order (little-endian) */
const ipv4Aus = (wort: string) =>
  [6, 4, 2, 0].map((i) => Number.parseInt(wort.slice(i, i + 2), 16)).join(".");

/**
 * A local address of /proc/net as text: IPv4 and IPv4 mapped into IPv6 as dotted quads, `::` and
 * `::1` by name; another IPv6 address as its hex words (only loopback and wildcard matter here)
 */
export const lokaleAdresse = (hex: string): string => {
  if (hex.length === 8) return ipv4Aus(hex);
  const worte = hex.toUpperCase().match(/.{8}/g) ?? [];
  if (worte[0] === "00000000" && worte[1] === "00000000") {
    if (worte[2] === "FFFF0000") return ipv4Aus(worte[3] ?? "");
    if (worte[2] === "00000000" && worte[3] === "00000000") return "::";
    if (worte[2] === "00000000" && worte[3] === "01000000") return "::1";
  }
  return hex;
};

const TABELLEN: [string, Proto][] = [
  ["/proc/net/tcp", "tcp"],
  ["/proc/net/tcp6", "tcp"],
  ["/proc/net/udp", "udp"],
  ["/proc/net/udp6", "udp"],
];

const tabellenLesen = (q: FaktenQuellen) =>
  Promise.all(TABELLEN.map(async ([pfad, proto]) => ({ text: await q.lesen(pfad), proto })));

/** Once per port and protocol, sorted by port */
const sortiert = (ports: Port[]): Port[] => {
  const schluessel = new Set(ports.map((p) => `${p.port}/${p.proto}`));
  return [...schluessel]
    .map((s) => {
      const [port, proto] = s.split("/");
      return { port: Number(port), proto: proto as Proto };
    })
    .sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
};

export const belegtePorts = async (q: FaktenQuellen): Promise<Port[] | null> => {
  const gelesen = await tabellenLesen(q);
  if (gelesen[0]?.text === undefined) return null;
  return sortiert(
    gelesen.flatMap(({ text, proto }) =>
      text === undefined ? [] : portsAus(text, proto).map((port) => ({ port, proto })),
    ),
  );
};

/** The IPv4 addresses of Podman's bridges: aardvark-dns listens there for a rootful network */
const brueckenAdressen = (q: FaktenQuellen): Set<string> =>
  new Set(
    Object.entries(q.schnittstellen())
      .filter(([name]) => FREMD.test(name))
      .flatMap(([, liste]) => liste ?? [])
      .map((info) => info.address),
  );

/**
 * The ports reachable from the network (Z-702): every listener but those on loopback (127.0.0.0/8,
 * ::1, also mapped) and on a Podman bridge; an installation's HTTP port on 127.0.0.1 is not one
 */
export const offenePorts = async (q: FaktenQuellen): Promise<Port[] | null> => {
  const gelesen = await tabellenLesen(q);
  if (gelesen[0]?.text === undefined) return null;
  const bruecken = brueckenAdressen(q);
  const intern = (adresse: string) =>
    adresse.startsWith("127.") || adresse === "::1" || bruecken.has(adresse);
  return sortiert(
    gelesen.flatMap(({ text, proto }) =>
      text === undefined
        ? []
        : socketsAus(text, proto)
            .filter((s) => !intern(lokaleAdresse(s.lokal)))
            .map((s) => ({ port: s.port, proto })),
    ),
  );
};

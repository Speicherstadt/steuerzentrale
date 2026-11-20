import type { NetworkInterfaceInfo } from "node:os";
import type { FaktenQuellen } from "./quellen.ts";

/*
 * The server in the network (BAULISTE.md Z-304): its addresses, their PTR records and whether it may
 * send mail out on port 25. Placement needs a public IPv4 for some apps and, for mail, a PTR and an
 * open port 25 (packages/manifest, platzierung.ts).
 */

// Podman's bridges and the virtual ends of its containers are no addresses of the server
const FREMD = /^(podman|cni-|veth|docker)/;

const istIpv4 = (info: NetworkInterfaceInfo) =>
  String(info.family) === "IPv4" || String(info.family) === "4";

const LINK_LOKAL = /^(169\.254\.|fe[89ab][0-9a-f]:)/i;

/** Public and private addresses of the server, without loopback, link-local and Podman's */
export const adressen = (q: FaktenQuellen): { ipv4: string[]; ipv6: string[] } => {
  const infos = Object.entries(q.schnittstellen())
    .filter(([name]) => !FREMD.test(name))
    .flatMap(([, liste]) => liste ?? [])
    .filter((info) => !info.internal && !LINK_LOKAL.test(info.address));
  const einmal = (liste: NetworkInterfaceInfo[]) => [...new Set(liste.map((i) => i.address))];
  return {
    ipv4: einmal(infos.filter(istIpv4)),
    ipv6: einmal(infos.filter((i) => !istIpv4(i))),
  };
};

const privatV4 = (ip: string) => {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254)
  );
};

/** Public: IPv4 outside the private, shared and loopback ranges; IPv6 global unicast (2000::/3) */
export const istOeffentlich = (ip: string): boolean =>
  ip.includes(":") ? /^[23][0-9a-f]{0,3}:/i.test(ip) : !privatV4(ip);

/** The first PTR name of each public address that has one */
export const ptrLesen = async (
  q: FaktenQuellen,
  ips: string[],
): Promise<Record<string, string>> => {
  const namen = await Promise.all(
    ips.filter(istOeffentlich).map(async (ip) => [ip, (await q.rueckwaerts(ip))?.[0]] as const),
  );
  return Object.fromEntries(namen.filter((paar): paar is [string, string] => Boolean(paar[1])));
};

/**
 * Where the agent tries port 25: Gmail's inbound mail server, always reachable on 25 from a network
 * that allows mail out (docs/plan.md, "Ausgehender Port 25"). Only the TCP connection, no SMTP.
 */
export const PORT25_ZIEL = "gmail-smtp-in.l.google.com";
const PORT25_LIMIT_MS = 5000;

export const port25Ausgehend = (q: FaktenQuellen): Promise<boolean | null> =>
  q.verbinden(PORT25_ZIEL, 25, PORT25_LIMIT_MS);

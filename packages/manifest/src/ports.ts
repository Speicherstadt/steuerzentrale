import type { Manifest } from "./schema.ts";

/*
 * The ports an installation opens to the network (BAULISTE.md Z-702): each port of `netz.ports` of a
 * container that runs with the chosen options, a range port by port, on the host port its Quadlet
 * publishes (quadlet/container.ts): a fixed one as written, an assigned one as the Zentrale gave it
 * (`ports`, keyed `<dienst>:<port>`). The HTTP service is published on 127.0.0.1 only and is not one.
 */

export type OffenerPort = { port: number; proto: "tcp" | "udp" };

export const veroeffentlichtePorts = (
  m: Manifest,
  optionen: readonly string[],
  ports: Readonly<Record<string, number>>,
): OffenerPort[] => {
  const laufen = new Set([
    ...m.container.map((c) => c.name),
    ...m.optionen
      .filter((o) => optionen.includes(o.id))
      .flatMap((o) => o.container.map((c) => c.name)),
  ]);
  return m.netz.ports
    .filter((p) => laufen.has(p.dienst))
    .flatMap((p) => {
      const host = p.fest ? p.port : ports[`${p.dienst}:${p.port}`];
      if (host === undefined) return [];
      const anzahl = (p.bis ?? p.port) - p.port + 1;
      return Array.from({ length: anzahl }, (_, i) => ({ port: host + i, proto: p.proto }));
    });
};

import type { Befund } from "../pruefungen.ts";
import type { Container, Manifest } from "../schema.ts";
import { systemdWort } from "./systemd.ts";
import type { QuadletInstallation } from "./typen.ts";
import { hostPort } from "./werte.ts";

/*
 * What must hold before a unit is written: every container that runs has an image by digest, its
 * argv and paths fit a unit line, and every port has a host port. Each finding names the field and
 * the reason, so a broken unit is never returned.
 */

// The Linux user is sz-<name>, and useradd takes at most 32 characters
const NAME = /^[a-z][a-z0-9-]{0,28}$/;
const KUNDE = /^[A-Za-z0-9._-]+$/;
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// A path inside a container: no ":" or "," (Volume= separators), no % or $ (systemd), no "." or ".."
const PFAD = /^(\/(?!\.\.?(\/|$))[A-Za-z0-9._-]+)+$/;

export type AktiverContainer = { c: Container; pfad: (string | number)[] };

/** The containers that run with the chosen options, with their place in the manifest */
export const aktiveContainer = (m: Manifest, optionen: readonly string[]): AktiverContainer[] => [
  ...m.container.map((c, i) => ({ c, pfad: ["container", i] })),
  ...m.optionen.flatMap((o, oi) =>
    optionen.includes(o.id)
      ? o.container.map((c, i) => ({ c, pfad: ["optionen", oi, "container", i] }))
      : [],
  ),
];

const installationBefunde = (m: Manifest, i: QuadletInstallation): Befund[] => {
  const befunde: Befund[] = [];
  const pruefe = (ok: boolean, feld: string, grund: string) => {
    if (!ok) befunde.push({ pfad: ["installation", feld], grund });
  };
  pruefe(NAME.test(i.name), "name", "a name of lowercase letters, digits and dashes, at most 29");
  pruefe(KUNDE.test(i.kundeId), "kundeId", "letters, digits, dot, dash and underscore");
  pruefe(HOST.test(i.host), "host", "a lowercase host name");
  pruefe(i.adresse === `https://${i.host}`, "adresse", "https:// and the host");
  pruefe(i.ipv4 === null || IPV4.test(i.ipv4), "ipv4", "an IPv4 address");
  for (const id of i.optionen)
    pruefe(
      m.optionen.some((o) => o.id === id),
      "optionen",
      `no option named ${id}`,
    );
  return befunde;
};

const containerBefunde = ({ c, pfad }: AktiverContainer): Befund[] => {
  const befunde: Befund[] = [];
  if (typeof c.image !== "string")
    befunde.push({
      pfad: [...pfad, "image"],
      grund: `${c.name} has no published image (${c.image.noch_nicht_veroeffentlicht}); an app without an image cannot be installed`,
    });
  for (const [i, wort] of (c.argv ?? []).entries())
    if (systemdWort(wort) === null)
      befunde.push({
        pfad: [...pfad, "argv", i],
        grund: "an argument is empty or has a control character; Quadlet drops an empty one",
      });
  for (const [art, liste] of [
    ["volumes", c.volumes],
    ["dateien", c.dateien],
  ] as const)
    for (const [i, x] of liste.entries())
      if (!PFAD.test(x.pfad))
        befunde.push({
          pfad: [...pfad, art, i, "pfad"],
          grund: "a path of letters, digits, '.', '_' and '-' between slashes, without . or ..",
        });
  return befunde;
};

const gueltigerPort = (p: number | null | undefined): p is number =>
  typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535;

const portBefunde = (m: Manifest, i: QuadletInstallation, laufen: Set<string>): Befund[] => {
  const befunde: Befund[] = [];
  if (m.netz.http && !gueltigerPort(i.httpPort))
    befunde.push({
      pfad: ["installation", "httpPort"],
      grund: "netz.http needs a port on 127.0.0.1",
    });
  const belegt: { von: number; bis: number; proto: string }[] = gueltigerPort(i.httpPort)
    ? [{ von: i.httpPort, bis: i.httpPort, proto: "tcp" }]
    : [];
  for (const [n, p] of m.netz.ports.entries()) {
    if (!laufen.has(p.dienst)) continue;
    const von = hostPort(m, i, p.dienst, p.port);
    const bis = (von ?? 0) + (p.bis ?? p.port) - p.port;
    if (!gueltigerPort(von) || !gueltigerPort(bis)) {
      befunde.push({
        pfad: ["netz", "ports", n],
        grund: `no valid host port for ${p.dienst}:${p.port}`,
      });
      continue;
    }
    if (belegt.some((b) => b.proto === p.proto && b.von <= bis && von <= b.bis))
      befunde.push({ pfad: ["netz", "ports", n], grund: `host port ${von} is taken twice` });
    belegt.push({ von, bis, proto: p.proto });
  }
  return befunde;
};

/** Every reason the installation cannot be rendered */
export const eingabeBefunde = (m: Manifest, i: QuadletInstallation): Befund[] => {
  const container = aktiveContainer(m, i.optionen);
  return [
    ...installationBefunde(m, i),
    ...container.flatMap(containerBefunde),
    ...portBefunde(m, i, new Set(container.map(({ c }) => c.name))),
  ];
};

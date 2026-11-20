import type { Container, Manifest } from "../schema.ts";
import { type Abschnitt, systemdWort, type Zeile } from "./systemd.ts";
import { DATEIEN_VERZEICHNIS, type QuadletInstallation } from "./typen.ts";
import type { Werte } from "./werte.ts";

/*
 * The .container unit of one container (podman-systemd.unit(5), v4.9.0; Haben's and Kontext's
 * deploy/quadlet/ as models). Rootless under the installation's own user; the HTTP service only on
 * 127.0.0.1; no AutoUpdate (updates come only through the waves); argv as Exec=, which Podman
 * appends after the image like `podman run IMAGE ARG…`: it replaces the image's CMD and keeps its
 * ENTRYPOINT (pkg/specgen/generate/oci.go, makeCommand).
 */

export type ContainerKontext = {
  manifest: Manifest;
  installation: QuadletInstallation;
  werte: Werte;
  /** The names of the containers that run with the chosen options */
  laufen: ReadonlySet<string>;
};

export const LABEL = "de.speicherstadt.steuerzentrale";

/** The name of a container, volume or unit of the installation */
export const name = (i: QuadletInstallation, teil: string): string => `${i.name}-${teil}`;

/** A Podman secret per setting: DATABASE_URL → <installation>-database-url */
export const secretName = (i: QuadletInstallation, einstellung: string): string =>
  name(i, einstellung.toLowerCase().replaceAll("_", "-"));

/** A word for the unit; the input checks rejected what cannot be written (eingabe.ts) */
const wort = (text: string): string => {
  const w = systemdWort(text);
  if (w === null) throw new Error(`cannot be written into a unit: ${JSON.stringify(text)}`);
  return w;
};

const veroeffentlichen = (k: ContainerKontext, c: Container): Zeile[] => {
  const { manifest: m, installation: i } = k;
  const http: Zeile[] =
    m.netz.http?.dienst === c.name
      ? [["PublishPort", `127.0.0.1:${i.httpPort}:${m.netz.http.port}`]]
      : [];
  const ports = m.netz.ports
    .filter((p) => p.dienst === c.name)
    .map((p): Zeile => {
      const host = p.fest ? p.port : (i.ports[`${p.dienst}:${p.port}`] ?? 0);
      const bereich = (von: number) =>
        p.bis === undefined ? `${von}` : `${von}-${von + p.bis - p.port}`;
      return ["PublishPort", `${bereich(host)}:${bereich(p.port)}/${p.proto}`];
    });
  return [...http, ...ports];
};

const einhaengen = (i: QuadletInstallation, c: Container): Zeile[] => [
  ...c.volumes.map((v): Zeile => ["Volume", `${name(i, v.name)}.volume:${v.pfad}`]),
  ...c.dateien.map(
    (d): Zeile => ["Volume", `%h/${DATEIEN_VERZEICHNIS}/${c.name}${d.pfad}:${d.pfad}:ro`],
  ),
];

const umgebung = (k: ContainerKontext, c: Container): Zeile[] => [
  ...Object.entries(c.feste_env).map(([n, w]): Zeile => ["Environment", wort(`${n}=${w}`)]),
  ...c.env.flatMap((n): Zeile[] => {
    const w = k.werte.get(n);
    if (!w) return [];
    return w.geheim
      ? [["Secret", `${secretName(k.installation, n)},type=env,target=${n}`]]
      : [["Environment", wort(`${n}=${w.wert}`)]];
  }),
];

const labels = (k: ContainerKontext): Zeile[] =>
  (
    [
      ["installation", k.installation.name],
      ["kunde", k.installation.kundeId],
      ["app", k.manifest.id],
      ["version", k.manifest.version],
    ] as const
  ).map(([n, w]): Zeile => ["Label", wort(`${LABEL}.${n}=${w}`)]);

export const containerAbschnitte = (k: ContainerKontext, c: Container): Abschnitt[] => {
  const i = k.installation;
  const braucht = c.braucht.filter((b) => k.laufen.has(b)).map((b) => `${name(i, b)}.service`);
  return [
    {
      name: "Unit",
      zeilen: [
        ["Description", `${k.manifest.id} ${k.manifest.version}, ${c.name} (${i.name})`],
        ...braucht.flatMap((s): Zeile[] => [
          ["Requires", s],
          ["After", s],
        ]),
      ],
    },
    {
      name: "Container",
      zeilen: [
        ["ContainerName", name(i, c.name)],
        ["Image", typeof c.image === "string" ? c.image : ""],
        // Reachable in the installation's network under its name from the manifest (docs/plan.md,
        // "Namen im Netz der Installation"); podman run --network <name>:alias=<alias>
        ["Network", `${i.name}.network:alias=${c.name}`],
        ...labels(k),
        ["NoNewPrivileges", "true"],
        ...veroeffentlichen(k, c),
        ...einhaengen(i, c),
        ...umgebung(k, c),
        ...(c.argv ? [["Exec", c.argv.map(wort).join(" ")] as Zeile] : []),
      ],
    },
    {
      name: "Service",
      zeilen: [
        ["Slice", `${i.name}.slice`],
        ...(c.ram_mb ? [["MemoryMax", `${c.ram_mb}M`] as Zeile] : []),
        ["Restart", "always"],
        // The agent pulls the images before it starts the units; a database may take its time
        ["TimeoutStartSec", "900"],
      ],
    },
    { name: "Install", zeilen: [["WantedBy", "default.target"]] },
  ];
};

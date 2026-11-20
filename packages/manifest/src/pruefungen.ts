import type { Manifest } from "./schema.ts";

/*
 * The rules across fields of a manifest: every reference names something that exists, steps are
 * names of commands (never shell text), no command starts a shell, and what needs a server of its
 * own declares it. Each finding names its field and the reason.
 */

export type Befund = { pfad: (string | number)[]; grund: string };

/**
 * Programs that would run whatever text they are given; a named command never starts one, neither
 * as its program nor as the argument of a wrapper (`timeout 60 sh -c …`, `nice bash -c …`)
 */
const SHELLS = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "ash",
  "ksh",
  "mksh",
  "csh",
  "tcsh",
  "yash",
  "rbash",
  "fish",
  "busybox",
  "toybox",
  "env",
  "su",
  "sudo",
]);

const shellBefunde = (argv: string[], pfad: (string | number)[]): Befund[] =>
  argv.flatMap((wert, i) => {
    const programm = wert.split("/").at(-1) ?? "";
    return SHELLS.has(programm)
      ? [{ pfad: [...pfad, i], grund: `${programm} would start a shell` }]
      : [];
  });

const doppelt = (werte: string[]): string[] => werte.filter((wert, i) => werte.indexOf(wert) !== i);

const alleContainer = (m: Manifest) => [
  ...m.container.map((c, i) => ({ c, pfad: ["container", i] as (string | number)[] })),
  ...m.optionen.flatMap((o, oi) =>
    o.container.map((c, i) => ({ c, pfad: ["optionen", oi, "container", i] })),
  ),
];

const containerRegeln = (m: Manifest): Befund[] => {
  const container = alleContainer(m);
  const namen = new Set(container.map(({ c }) => c.name));
  const env = new Set(m.env.map((e) => e.name));
  const befunde: Befund[] = doppelt(container.map(({ c }) => c.name)).map((name) => ({
    pfad: ["container"],
    grund: `container ${name} is declared twice`,
  }));
  for (const { c, pfad } of container) {
    befunde.push(...shellBefunde(c.argv ?? [], [...pfad, "argv"]));
    for (const [i, ziel] of c.braucht.entries())
      if (!namen.has(ziel))
        befunde.push({ pfad: [...pfad, "braucht", i], grund: `no container named ${ziel}` });
    for (const [i, name] of c.env.entries())
      if (!env.has(name))
        befunde.push({ pfad: [...pfad, "env", i], grund: `${name} is not declared under env` });
    for (const [i, arch] of (c.architektur ?? []).entries())
      if (!m.architektur.includes(arch) && pfad[0] === "container")
        befunde.push({
          pfad: [...pfad, "architektur", i],
          grund: `${arch} is not an architecture of the app`,
        });
  }
  return befunde;
};

const dienstRegeln = (m: Manifest): Befund[] => {
  const namen = new Set(alleContainer(m).map(({ c }) => c.name));
  const befunde: Befund[] = [];
  const pruefe = (dienst: string, pfad: (string | number)[]) => {
    if (!namen.has(dienst)) befunde.push({ pfad, grund: `no container named ${dienst}` });
  };
  if (m.netz.http) pruefe(m.netz.http.dienst, ["netz", "http", "dienst"]);
  for (const [i, p] of m.netz.ports.entries()) {
    pruefe(p.dienst, ["netz", "ports", i, "dienst"]);
    if (p.bis !== undefined && p.bis < p.port)
      befunde.push({ pfad: ["netz", "ports", i, "bis"], grund: "bis is below port" });
  }
  if (m.health.art === "http" || m.health.art === "tcp")
    pruefe(m.health.dienst, ["health", "dienst"]);
  for (const [name, b] of Object.entries(m.befehle))
    pruefe(b.container, ["befehle", name, "container"]);
  for (const [i, teil] of m.backup.entries())
    if (teil.art === "pg_dump") pruefe(teil.container, ["backup", i, "container"]);
  return befunde;
};

const befehlRegeln = (m: Manifest): Befund[] => {
  const befehle = new Set(Object.keys(m.befehle));
  const befunde: Befund[] = [];
  const pruefe = (name: string, pfad: (string | number)[]) => {
    if (!befehle.has(name))
      befunde.push({
        pfad,
        grund: `${JSON.stringify(name)} is not the name of a command under befehle`,
      });
  };
  for (const [name, b] of Object.entries(m.befehle))
    befunde.push(...shellBefunde(b.argv, ["befehle", name, "argv"]));
  for (const art of ["einrichten", "nach_update"] as const)
    for (const [i, name] of m.schritte[art].entries()) pruefe(name, ["schritte", art, i]);
  if (m.health.art === "befehl") pruefe(m.health.befehl, ["health", "befehl"]);
  for (const [i, teil] of m.backup.entries())
    if (teil.art === "befehl") pruefe(teil.befehl, ["backup", i, "befehl"]);
  for (const art of ["nur_lesen", "export"] as const) {
    const aktion = m.aktionen[art];
    if (typeof aktion === "object" && "befehl" in aktion)
      pruefe(aktion.befehl, ["aktionen", art, "befehl"]);
  }
  return befunde;
};

const volumeRegeln = (m: Manifest): Befund[] => {
  const volumes = new Set(alleContainer(m).flatMap(({ c }) => c.volumes.map((v) => v.name)));
  return m.backup.flatMap((teil, i) =>
    teil.art === "volume" && !volumes.has(teil.volume)
      ? [
          {
            pfad: ["backup", i, "volume"],
            grund: `no container mounts a volume named ${teil.volume}`,
          },
        ]
      : [],
  );
};

const serverRegeln = (m: Manifest): Befund[] => {
  const befunde: Befund[] = [];
  if (m.rootful && !m.netz.server_fuer_sich)
    befunde.push({ pfad: ["rootful"], grund: "rootful needs netz.server_fuer_sich: true" });
  if (m.proxy === "eigen" && !m.netz.server_fuer_sich)
    befunde.push({
      pfad: ["proxy"],
      grund: "a proxy of its own needs netz.server_fuer_sich: true",
    });
  if (m.proxy === "geteilt" && m.netz.http === null)
    befunde.push({ pfad: ["netz", "http"], grund: "the shared proxy needs netz.http" });
  return befunde;
};

const envRegeln = (m: Manifest): Befund[] => {
  const befunde: Befund[] = doppelt(m.env.map((e) => e.name)).map((name) => ({
    pfad: ["env"],
    grund: `${name} is declared twice`,
  }));
  for (const [i, e] of m.env.entries()) {
    const quellen = [e.erzeugen, e.aus, e.vorlage].filter((q) => q !== undefined).length;
    if (e.ebene === "auto" && quellen !== 1)
      befunde.push({
        pfad: ["env", i],
        grund: "an auto value needs exactly one of erzeugen, aus or vorlage",
      });
    if (e.ebene !== "auto" && quellen > 0)
      befunde.push({
        pfad: ["env", i],
        grund: "only an auto value is generated (erzeugen, aus, vorlage)",
      });
  }
  return befunde;
};

/**
 * What a `vorlage` or a DNS record may name as `${…}` (docs/manifest.md, "Vorlagen"): the
 * installation's address and host, the server's public IPv4, the port the Zentrale assigned to a
 * published port, and another setting that is no template itself (so templates never form a
 * cycle). Containers reach each other by their name in the manifest, which needs no placeholder
 */
const platzhalterGrund = (m: Manifest, platzhalter: string): string | null => {
  if (["adresse", "host", "ipv4"].includes(platzhalter)) return null;
  const [art, ...teile] = platzhalter.split(":");
  if (art === "port" && teile.length === 2) {
    const [dienst, port] = [teile[0], Number(teile[1])];
    const veroeffentlicht = [...m.netz.ports, ...(m.netz.http ? [m.netz.http] : [])];
    return veroeffentlicht.some((p) => p.dienst === dienst && p.port === port)
      ? null
      : `no port ${teile[1]} of ${dienst} under netz`;
  }
  if (art === "env" && teile.length === 1) {
    const ziel = m.env.find((e) => e.name === teile[0]);
    if (!ziel) return `${teile[0]} is not declared under env`;
    return ziel.vorlage === undefined ? null : `${teile[0]} is a template itself`;
  }
  return `\${${platzhalter}} is no placeholder (adresse, host, ipv4, port:, env:)`;
};

const platzhalterBefunde = (m: Manifest, text: string, pfad: (string | number)[]): Befund[] =>
  [...text.matchAll(/\$\{([^{}]*)\}/g)].flatMap(([, platzhalter]) => {
    const grund = platzhalterGrund(m, platzhalter ?? "");
    return grund ? [{ pfad, grund }] : [];
  });

/** The secret settings a text names as ${env:…} */
const genannteGeheimnisse = (m: Manifest, text: string): string[] =>
  [...text.matchAll(/\$\{env:([^{}]*)\}/g)].flatMap(([, name]) =>
    m.env.some((e) => e.name === name && e.typ === "geheim") ? [name ?? ""] : [],
  );

/** A secret stays a secret: a template naming one is geheim itself, a DNS record (public) names none */
const geheimnisBefunde = (m: Manifest): Befund[] => [
  ...m.env.flatMap((e, i) =>
    e.typ === "geheim"
      ? []
      : genannteGeheimnisse(m, e.vorlage ?? "").map((name) => ({
          pfad: ["env", i, "vorlage"],
          grund: `${name} is a secret, so this setting needs typ: geheim`,
        })),
  ),
  ...m.dns.flatMap((d, i) =>
    (["name", "wert"] as const).flatMap((feld) =>
      genannteGeheimnisse(m, d[feld]).map((name) => ({
        pfad: ["dns", i, feld],
        grund: `${name} is a secret and a DNS record is public`,
      })),
    ),
  ),
];

const vorlageRegeln = (m: Manifest): Befund[] => [
  ...m.env.flatMap((e, i) => platzhalterBefunde(m, e.vorlage ?? "", ["env", i, "vorlage"])),
  ...m.dns.flatMap((d, i) => [
    ...platzhalterBefunde(m, d.name, ["dns", i, "name"]),
    ...platzhalterBefunde(m, d.wert, ["dns", i, "wert"]),
  ]),
  ...geheimnisBefunde(m),
];

/** A setting that belongs to an option is set only while that option is on */
const optionRegeln = (m: Manifest): Befund[] => {
  const optionen = new Set(m.optionen.map((o) => o.id));
  return m.env.flatMap((e, i) =>
    e.option !== undefined && !optionen.has(e.option)
      ? [{ pfad: ["env", i, "option"], grund: `no option named ${e.option}` }]
      : [],
  );
};

const weitereRegeln = (m: Manifest): Befund[] => [
  ...doppelt(m.optionen.map((o) => o.id)).map((id) => ({
    pfad: ["optionen"],
    grund: `option ${id} is declared twice`,
  })),
];

export const regelnPruefen = (m: Manifest): Befund[] => [
  ...containerRegeln(m),
  ...dienstRegeln(m),
  ...befehlRegeln(m),
  ...volumeRegeln(m),
  ...serverRegeln(m),
  ...envRegeln(m),
  ...vorlageRegeln(m),
  ...optionRegeln(m),
  ...weitereRegeln(m),
];

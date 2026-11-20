import type { Befund } from "../pruefungen.ts";
import type { Manifest } from "../schema.ts";
import type { QuadletAnfrage, QuadletInstallation, Wert } from "./typen.ts";

/*
 * The value of every setting an installation uses (docs/plan.md, "Vorlagen und erzeugte Werte"):
 * set by the operator or with its default, generated once by the Zentrale and passed in, the
 * installation's address, or a template filled from those. A setting of an option counts only while
 * the option is on. Nothing is generated here.
 */

export type Aufgeloest = { wert: string; geheim: boolean };
export type Werte = ReadonlyMap<string, Aufgeloest>;

type Einstellung = Manifest["env"][number];

const text = (wert: Wert): string => (typeof wert === "string" ? wert : String(wert));

/** The settings that apply with the chosen options */
export const aktiveEinstellungen = (m: Manifest, optionen: readonly string[]): Einstellung[] =>
  m.env.filter((e) => e.option === undefined || optionen.includes(e.option));

/** A setting's own value, before templates; undefined when it has none */
const gesetzterWert = (e: Einstellung, a: QuadletAnfrage): Wert | undefined => {
  if (e.ebene === "betreiber") return a.einstellungen.betreiber[e.name] ?? e.vorgabe;
  if (e.ebene === "installation") return a.einstellungen.installation[e.name] ?? e.vorgabe;
  if (e.aus === "adresse") return a.installation.adresse;
  return a.einstellungen.auto[e.name];
};

/**
 * An empty secret counts as not set: Podman refuses a secret of 0 bytes ("secret data must be
 * larger than 0", pkg/secrets/secrets.go of containers/common in Podman v4.9.0)
 */
const eigenerWert = (e: Einstellung, a: QuadletAnfrage): Wert | undefined => {
  const wert = gesetzterWert(e, a);
  return e.typ === "geheim" && wert === "" ? undefined : wert;
};

const fehltGrund = (e: Einstellung): string | null => {
  if (e.erzeugen !== undefined)
    return `${e.name} is generated once by the Zentrale and stored encrypted; it must be passed in, rendering generates nothing`;
  if (e.pflicht) return `${e.name} is required and has no value`;
  return null;
};

/** The host port an installation reaches `<dienst>:<port>` of netz on */
export const hostPort = (
  m: Manifest,
  i: QuadletInstallation,
  dienst: string,
  port: number,
): number | undefined => {
  if (m.netz.http?.dienst === dienst && m.netz.http.port === port) return i.httpPort ?? undefined;
  const p = m.netz.ports.find((x) => x.dienst === dienst && x.port === port);
  if (!p) return undefined;
  return p.fest ? p.port : i.ports[`${dienst}:${port}`];
};

/** The value of one placeholder, or why there is none */
const platzhalterWert = (
  platzhalter: string,
  a: QuadletAnfrage,
  eigene: Werte,
): { wert: string } | { grund: string } => {
  const i = a.installation;
  if (platzhalter === "adresse") return { wert: i.adresse };
  if (platzhalter === "host") return { wert: i.host };
  if (platzhalter === "ipv4")
    return i.ipv4 === null ? { grund: "the server has no public IPv4" } : { wert: i.ipv4 };
  const [art, ...teile] = platzhalter.split(":");
  if (art === "port" && teile.length === 2) {
    const port = hostPort(a.manifest, i, teile[0] ?? "", Number(teile[1]));
    return port === undefined
      ? { grund: `no port assigned for ${teile.join(":")}` }
      : { wert: String(port) };
  }
  if (art === "env" && teile.length === 1) {
    const ziel = eigene.get(teile[0] ?? "");
    return ziel ? { wert: ziel.wert } : { grund: `${teile[0]} has no value` };
  }
  return { grund: `\${${platzhalter}} is no placeholder` };
};

/** A template filled in; text in other braces stays text (docs/manifest.md, "Vorlagen") */
const fuellen = (
  vorlage: string,
  a: QuadletAnfrage,
  eigene: Werte,
): { wert: string } | { gruende: string[] } => {
  const gruende: string[] = [];
  const wert = vorlage.replaceAll(/\$\{([^{}]*)\}/g, (_, platzhalter: string) => {
    const w = platzhalterWert(platzhalter, a, eigene);
    if ("grund" in w) {
      gruende.push(w.grund);
      return "";
    }
    return w.wert;
  });
  return gruende.length > 0 ? { gruende } : { wert };
};

/** The value of every setting that applies, or every reason one is missing */
export const werteAufloesen = (a: QuadletAnfrage): { werte: Werte; befunde: Befund[] } => {
  const aktiv = aktiveEinstellungen(a.manifest, a.installation.optionen);
  const pfad = (e: Einstellung) => ["env", a.manifest.env.indexOf(e)];
  const befunde: Befund[] = [];
  const eigene = new Map<string, Aufgeloest>();
  for (const e of aktiv.filter((x) => x.vorlage === undefined)) {
    const wert = eigenerWert(e, a);
    const grund = wert === undefined ? fehltGrund(e) : null;
    if (grund) befunde.push({ pfad: pfad(e), grund });
    if (wert !== undefined) eigene.set(e.name, { wert: text(wert), geheim: e.typ === "geheim" });
  }
  const werte = new Map(eigene);
  for (const e of aktiv.filter((x) => x.vorlage !== undefined)) {
    const gefuellt = fuellen(e.vorlage ?? "", a, eigene);
    if ("gruende" in gefuellt)
      befunde.push(...gefuellt.gruende.map((grund) => ({ pfad: [...pfad(e), "vorlage"], grund })));
    else werte.set(e.name, { wert: gefuellt.wert, geheim: e.typ === "geheim" });
  }
  return { werte, befunde };
};

import { PFORTE_PORT } from "../pforte/auftraege.ts";
import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import { quadletsRendern } from "../quadlet/rendern.ts";
import type { QuadletEinstellungen, QuadletInstallation, Quadlets } from "../quadlet/typen.ts";
import type { Manifest } from "../schema.ts";

/*
 * The setup jobs (BAULISTE.md Z-402; docs/plan.md, "Einrichtungsaufträge"): built into the
 * Steuerzentrale like the Pforte's, with a fixed shape. A setup job carries the signed manifest, the
 * installation's name and what the Zentrale knows of it (customer, host, ports, options, settings);
 * the units, secrets and files are rendered from the manifest with quadletsRendern, never taken
 * from the job, so a job cannot name an image, a unit line or an argv. Pure: the Zentrale checks a
 * job with it when it makes one, the agent again after key and signature. Reconfiguring (Z-404;
 * docs/plan.md, "Neu konfigurieren") has the same shape and check; it runs no setup steps.
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name these */
export const EINRICHTUNG_AKTIONEN = {
  einrichten: "installation_einrichten",
  entfernen: "installation_entfernen",
  konfigurieren: "installation_konfigurieren",
} as const;

/** Pulling images and the setup steps take a while; the Zentrale may shorten this */
export const EINRICHTUNG_ZEITLIMIT_S = 1800;

/** What a setup job tells of the installation besides its name (packages/protokoll, `Einrichtung`) */
export type Einrichtung = {
  installation: Omit<QuadletInstallation, "name" | "adresse">;
  einstellungen: QuadletEinstellungen;
};

export type EinrichtungAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, string | number | boolean>>;
  einrichtung?: Einrichtung | undefined;
};

/** What setting up and reconfiguring both render from the signed manifest */
type Gerendert = {
  name: string;
  quadlets: Quadlets;
  /** The systemd services Quadlet makes of the containers that run, in order */
  units: string[];
};

export type EinrichtungAuftrag =
  | (Gerendert & {
      art: "einrichten";
      /** The names of the commands of `schritte.einrichten`, run once the units are up */
      schritte: string[];
    })
  | (Gerendert & { art: "konfigurieren" })
  | { art: "entfernen"; name: string };

export type EinrichtungGeprueft =
  | { ok: true; auftrag: EinrichtungAuftrag }
  | { ok: false; grund: string };

export const istEinrichtungAktion = (aktion: string): boolean =>
  Object.values<string>(EINRICHTUNG_AKTIONEN).includes(aktion);

const nein = (grund: string): EinrichtungGeprueft => ({ ok: false, grund });

const zugewiesen = (p: unknown): boolean =>
  typeof p === "number" && Number.isSafeInteger(p) && p >= PFORTE_PORT.min && p <= PFORTE_PORT.max;

/** A port the Zentrale assigns: never a privileged one, and only for a port the manifest has */
const portBefunde = (m: Manifest, i: Einrichtung["installation"]): string[] => {
  const bereich = `an integer from ${PFORTE_PORT.min} to ${PFORTE_PORT.max}`;
  const befunde: string[] = [];
  if (i.httpPort !== null && !zugewiesen(i.httpPort)) befunde.push(`httpPort: ${bereich}`);
  const vergeben = new Set(m.netz.ports.filter((p) => !p.fest).map((p) => `${p.dienst}:${p.port}`));
  for (const [schluessel, port] of Object.entries(i.ports)) {
    if (!vergeben.has(schluessel))
      befunde.push(`ports.${schluessel}: the manifest assigns no such port`);
    else if (!zugewiesen(port)) befunde.push(`ports.${schluessel}: ${bereich}`);
  }
  return befunde;
};

const rendern = (
  m: Manifest,
  name: string,
  e: Einrichtung,
): { ok: true; gerendert: Gerendert } | { ok: false; grund: string } => {
  const ports = portBefunde(m, e.installation);
  if (ports.length > 0) return { ok: false, grund: ports.join("; ") };
  const r = quadletsRendern({
    manifest: m,
    installation: { ...e.installation, name, adresse: `https://${e.installation.host}` },
    einstellungen: e.einstellungen,
  });
  if (!r.ok)
    return { ok: false, grund: r.gruende.map((g) => `${g.pfad.join(".")}: ${g.grund}`).join("; ") };
  const units = Object.keys(r.quadlets.units)
    .filter((u) => u.endsWith(".container"))
    .map((u) => u.replace(/\.container$/, ".service"))
    .sort();
  return { ok: true, gerendert: { name, quadlets: r.quadlets, units } };
};

export const einrichtungAuftragPruefen = (
  m: Manifest,
  a: EinrichtungAnfrage,
): EinrichtungGeprueft => {
  if (!istEinrichtungAktion(a.aktion)) return nein(`${a.aktion} is not a setup job`);
  const name = a.installationId;
  if (name === null || !INSTALLATIONS_NAME.test(name))
    return nein("a setup job belongs to a named installation");
  const fremd = Object.keys(a.argumente);
  if (fremd.length > 0) return nein(`unknown argument ${fremd.join(", ")}`);
  if (a.aktion === EINRICHTUNG_AKTIONEN.entfernen)
    return a.einrichtung === undefined
      ? { ok: true, auftrag: { art: "entfernen", name } }
      : nein("removing takes no installation data (einrichtung)");
  if (a.einrichtung === undefined)
    return nein("setting up needs the installation data (einrichtung)");
  const r = rendern(m, name, a.einrichtung);
  if (!r.ok) return r;
  return a.aktion === EINRICHTUNG_AKTIONEN.konfigurieren
    ? { ok: true, auftrag: { art: "konfigurieren", ...r.gerendert } }
    : { ok: true, auftrag: { art: "einrichten", ...r.gerendert, schritte: m.schritte.einrichten } };
};

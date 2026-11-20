import { berlinTag, tageSpaeter } from "../format/zeit.ts";
import type { Bestand, Installation, Kunde, Manifest, Server, Sperrzeit, Ziel } from "./typen.ts";

/*
 * Lookups and facts derived from the data, pure: data in, data out. The pages call these instead of
 * walking the lists themselves, so a page never knows an app by name.
 */

const finde = <T extends { id: string }>(liste: T[], id: string, was: string): T => {
  const treffer = liste.find((x) => x.id === id);
  if (!treffer) throw new Error(`${was} ${id} not found`);
  return treffer;
};

export const appVon = (b: Bestand, id: string): Manifest => finde(b.apps, id, "app");
export const kundeVon = (b: Bestand, id: string): Kunde => finde(b.kunden, id, "customer");
export const serverVon = (b: Bestand, id: string): Server => finde(b.server, id, "server");
export const installationVon = (b: Bestand, id: string): Installation =>
  finde(b.installationen, id, "installation");

/** For a route parameter: undefined instead of an error for an unknown ID */
export const suche = <T extends { id: string }>(liste: T[], id: string): T | undefined =>
  liste.find((x) => x.id === id);

export const installationenAuf = (b: Bestand, server: string) =>
  b.installationen.filter((i) => i.server === server);

export const installationenVon = (b: Bestand, kunde: string) =>
  b.installationen.filter((i) => i.kunde === kunde);

export const installationenDer = (b: Bestand, app: string) =>
  b.installationen.filter((i) => i.app === app);

/** The customers with an installation on a server, each once, in the order of the installations */
export const kundenAuf = (b: Bestand, server: string): Kunde[] => [
  ...new Set(installationenAuf(b, server).map((i) => kundeVon(b, i.kunde))),
];

/** The servers a customer's installations run on, each once */
export const serverVonKunde = (b: Bestand, kunde: string): Server[] => [
  ...new Set(installationenVon(b, kunde).map((i) => serverVon(b, i.server))),
];

/** On the newest version with a signed manifest (an app without image has none to reach) */
export const istAktuell = (b: Bestand, i: Installation) => {
  const neu = appVon(b, i.app).version;
  return neu === null || i.version === neu;
};

/** Days from the end of a contract to the deletion of its data (docs/plan.md, "Kündigung und Löschung") */
export const LOESCHFRIST_TAGE = 90;

/** The day a customer's installations and backups are deleted, once its contract ends */
export const loeschungAm = (ende: number) => tageSpaeter(ende, LOESCHFRIST_TAGE);

export const istGekuendigt = (b: Bestand, i: Installation) =>
  kundeVon(b, i.kunde).vertrag.ende !== null;

export const istIntern = (b: Bestand, i: Installation) => Boolean(kundeVon(b, i.kunde).intern);

export const linuxNutzer = (i: Installation) => `sz-${i.id}`;

/** "Customer · App", the name of an installation in lists and headings */
export const titel = (b: Bestand, i: Installation) =>
  `${kundeVon(b, i.kunde).name} · ${appVon(b, i.app).name}`;

export type SperrzeitEinerApp = Sperrzeit & { app: string; appName: string };

/** The freeze windows of every app, from the manifests */
export const alleSperrzeiten = (b: Bestand): SperrzeitEinerApp[] =>
  b.apps.flatMap((a) => a.sperrzeiten.map((z) => ({ ...z, app: a.id, appName: a.name })));

/** The freeze windows of the apps installed on a server: they block its reboots too */
export const sperrzeitenAuf = (b: Bestand, server: string): SperrzeitEinerApp[] => {
  const apps = new Set(installationenAuf(b, server).map((i) => i.app));
  return alleSperrzeiten(b).filter((z) => apps.has(z.app));
};

/** A monthly window holds on the days `von` to `bis` of the month in Berlin */
export const sperrzeitAktiv = (z: Sperrzeit, jetzt: number) => {
  const tag = berlinTag(jetzt);
  return tag >= z.von && tag <= z.bis;
};

/** RAM the manifests of a server's installations may use, in MB (limits, docs/plan.md "Ressourcen") */
export const ramVergebenMb = (b: Bestand, server: string) =>
  installationenAuf(b, server).reduce((summe, i) => summe + appVon(b, i.app).ramMb, 0);

/** The installations of a server or customer an event, job or entry is about */
export const betrifft = (ziel: Ziel, ids: Set<string>) =>
  (ziel.art === "installation" || ziel.art === "server") && ids.has(ziel.id);

/** Minutes of support a customer got in a month ("2026-11"), from the support accesses */
export const supportMinuten = (b: Bestand, kunde: string, monat: string) => {
  const ids = new Set(installationenVon(b, kunde).map((i) => i.id));
  return b.zugaenge
    .filter((z) => ids.has(z.installation) && monatVon(z.start) === monat)
    .reduce((summe, z) => summe + z.minuten, 0);
};

/** The month of an instant in Berlin, as "2026-11" */
export const monatVon = (instant: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" })
    .format(instant)
    .slice(0, 7);

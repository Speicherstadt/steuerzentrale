import { berlinTag, tageSpaeter } from "../format/zeit.ts";
import type { Bestand, Installation, Kunde, Manifest, Sperrzeit } from "./typen.ts";

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
export const installationVon = (b: Bestand, id: string): Installation =>
  finde(b.installationen, id, "installation");

/** For a route parameter: undefined instead of an error for an unknown ID */
export const suche = <T extends { id: string }>(liste: T[], id: string): T | undefined =>
  liste.find((x) => x.id === id);

export const installationenAuf = (b: Bestand, server: string) =>
  b.installationen.filter((i) => i.server === server);

/** Days from the end of a contract to the deletion of its data (docs/plan.md, "Kündigung und Löschung") */
export const LOESCHFRIST_TAGE = 90;

/** The day a customer's installations and backups are deleted, once its contract ends */
export const loeschungAm = (ende: number) => tageSpaeter(ende, LOESCHFRIST_TAGE);

export const istGekuendigt = (b: Bestand, i: Installation) =>
  kundeVon(b, i.kunde).vertrag.ende !== null;

export const istIntern = (b: Bestand, i: Installation) => Boolean(kundeVon(b, i.kunde).intern);

/** "Customer · App", the name of an installation in lists and headings */
export const titel = (b: Bestand, i: Installation) =>
  `${kundeVon(b, i.kunde).name} · ${appVon(b, i.app).name}`;

/** "App · Customer", the heading of an app's page and its place in the path */
export const appTitel = (b: Bestand, i: Installation) =>
  `${appVon(b, i.app).name} · ${kundeVon(b, i.kunde).name}`;

export type SperrzeitEinerApp = Sperrzeit & { app: string; appName: string };

/** The freeze windows of every app, from the manifests */
export const alleSperrzeiten = (b: Bestand): SperrzeitEinerApp[] =>
  b.apps.flatMap((a) => a.sperrzeiten.map((z) => ({ ...z, app: a.id, appName: a.name })));

/** The freeze windows of these apps, from their descriptions (until manifests are imported, Z-501) */
export const sperrzeitenDer = (b: Bestand, apps: string[]): SperrzeitEinerApp[] => {
  const da = new Set(apps);
  return alleSperrzeiten(b).filter((z) => da.has(z.app));
};

/** RAM the manifests of these installed apps may use, in MB; an app the descriptions lack counts 0 */
export const ramDerMb = (b: Bestand, apps: string[]) =>
  apps.reduce((summe, app) => summe + (suche(b.apps, app)?.ramMb ?? 0), 0);

/** A monthly window holds on the days `von` to `bis` of the month in Berlin */
export const sperrzeitAktiv = (z: Sperrzeit, jetzt: number) => {
  const tag = berlinTag(jetzt);
  return tag >= z.von && tag <= z.bis;
};

/** The month of an instant in Berlin, as "2026-11" */
export const monatVon = (instant: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" })
    .format(instant)
    .slice(0, 7);

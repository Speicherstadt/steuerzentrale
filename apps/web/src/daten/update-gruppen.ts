import { berlinTag, tageSpaeter } from "../format/zeit.ts";
import type { InstallationsAngebot } from "./apps.ts";
import type { Sperrzeit } from "./typen.ts";

/*
 * The page "Updates" sorted for a person (docs/updates.md): the installations that can update,
 * grouped by app, apart from those already current; and which freeze windows matter this week.
 * Pure: data in, data out.
 */

export type AppGruppe = {
  app: string;
  /** The newest version offered in the group, a pre-release only if nothing else is offered */
  neueste: string;
  installationen: InstallationsAngebot[];
};

/** Offers come newest first (packages/planung, angeboteneVersionen) */
const neuesteVon = (liste: InstallationsAngebot[]): string => {
  const erste = liste.flatMap((i) => i.angeboten.slice(0, 1));
  return (erste.find((v) => !v.vorabversion) ?? erste[0])?.version ?? "";
};

/** Installations offered a newer version, one group per app in the order they first appear */
export const nachApp = (liste: InstallationsAngebot[]): AppGruppe[] => {
  const gruppen = new Map<string, InstallationsAngebot[]>();
  for (const i of liste.filter((x) => x.angeboten.length > 0)) {
    gruppen.set(i.app, [...(gruppen.get(i.app) ?? []), i]);
  }
  return [...gruppen].map(([app, installationen]) => ({
    app,
    neueste: neuesteVon(installationen),
    installationen,
  }));
};

/** Installations that run the newest version they are offered */
export const aufDemNeuesten = (liste: InstallationsAngebot[]): InstallationsAngebot[] =>
  liste.filter((i) => i.angeboten.length === 0);

/** Whether a monthly window holds on this day of the month; `28-03` reaches over the month's end */
const imFenster = (z: Sperrzeit, tag: number) =>
  z.von <= z.bis ? tag >= z.von && tag <= z.bis : tag >= z.von || tag <= z.bis;

/** Whether a monthly freeze window holds today or begins within the next `tage` days (Berlin) */
export const sperrzeitBald = (z: Sperrzeit, jetzt: number, tage = 7): boolean =>
  Array.from({ length: tage + 1 }, (_, n) => berlinTag(tageSpaeter(jetzt, n))).some((tag) =>
    imFenster(z, tag),
  );

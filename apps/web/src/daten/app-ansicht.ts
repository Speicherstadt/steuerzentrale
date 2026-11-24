import { versionVergleichen } from "@steuerzentrale/planung";
import { sperrzeitAktiv } from "./ableitungen.ts";
import type { AppDerZentrale } from "./apps.ts";
import type { Manifest } from "./typen.ts";

/*
 * What a tile on the page Apps says about an app, as data: its newest imported version and the one
 * hint that matters now (a freeze window that holds, a newer version whose manifest is missing,
 * installations behind the newest version), or none. Pure, so the tile only shows it.
 */

export type AppHinweis =
  | { art: "sperrzeit"; bis: number }
  | { art: "manifest_fehlt"; version: string }
  | { art: "update"; version: string; n: number };

/** The newest version with an imported manifest, a pre-release only if nothing else is there */
export const neuesteVersion = (v: AppDerZentrale | undefined): string | undefined => {
  const verfuegbar = (v?.versionen ?? []).filter((x) => x.zustand === "verfuegbar");
  return (verfuegbar.find((x) => !x.vorabversion) ?? verfuegbar[0])?.version;
};

/** The one hint of a tile: a holding freeze window first, then what is new */
export const appHinweis = (
  a: Manifest | undefined,
  v: AppDerZentrale | undefined,
  installiert: string[],
  jetzt: number,
): AppHinweis | undefined => {
  const sperre = a?.sperrzeiten.find((z) => sperrzeitAktiv(z, jetzt));
  if (sperre) return { art: "sperrzeit", bis: sperre.bis };
  const fehlt = v?.versionen.find((x) => x.zustand === "manifest_fehlt");
  if (fehlt) return { art: "manifest_fehlt", version: fehlt.version };
  const neueste = neuesteVersion(v);
  const zurueck = neueste
    ? installiert.filter((x) => versionVergleichen(x, neueste) < 0).length
    : 0;
  return neueste && zurueck > 0 ? { art: "update", version: neueste, n: zurueck } : undefined;
};

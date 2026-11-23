import { existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

/*
 * The built interface (apps/web/dist) from STEUERZENTRALE_WEB (BAULISTE.md Z-1004): the image of
 * the Zentrale carries it, so one process serves API and SPA ("Hono-Server mit SPA", docs/plan.md).
 * A path without a file extension is a route of the SPA's router and gets index.html; the API's
 * and the agents' paths never come here, and nothing outside the folder is read.
 */

const NICHT_WEB = ["/api/", "/agent/"];

const istDatei = (pfad: string): boolean => existsSync(pfad) && statSync(pfad).isFile();

const entschluesseln = (pfad: string): string | undefined => {
  try {
    return decodeURIComponent(pfad);
  } catch {
    return undefined;
  }
};

/** The file to answer a GET of `pfad` with, or undefined for 404 */
export const webDatei = (ordner: string, pfad: string): string | undefined => {
  if (NICHT_WEB.some((p) => pfad.startsWith(p))) return undefined;
  const entschluesselt = entschluesseln(pfad);
  if (entschluesselt === undefined) return undefined;
  const wurzel = resolve(ordner);
  const ziel = resolve(wurzel, `.${entschluesselt}`);
  if (ziel !== wurzel && !ziel.startsWith(wurzel + sep)) return undefined;
  if (istDatei(ziel)) return ziel;
  const index = join(wurzel, "index.html");
  if (extname(ziel) === "" && istDatei(index)) return index;
  return undefined;
};

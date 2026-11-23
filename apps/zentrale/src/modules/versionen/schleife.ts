import type { Planer } from "../aufbewahrung/index.ts";
import { appsMitManifest, type VersionenDeps, versionenAbfragen } from "./abfrage.ts";
import { type VersionsStand, versionsStand } from "./stand.ts";

/*
 * When the registries are asked (docs/plan.md, "Versionen aus den Registries (Z-501)"): at the
 * start, then every 6 hours, on demand ("Registry abfragen", routes/manifeste.ts) and for an app
 * whose first manifest was just imported. One query at a time: a second request waits for the one
 * running and then asks again, so a button pressed during the 6-hourly run still gets fresh tags.
 */

export const ABFRAGE_MS = 6 * 60 * 60_000;

export type Versionen = {
  stand: VersionsStand;
  /** Asks the registries of `apps` (all with a manifest) and resolves once they answered */
  abfragen: (apps?: readonly string[]) => Promise<void>;
};

export const versionen = (deps: VersionenDeps): Versionen => {
  const stand = versionsStand();
  let laufend: Promise<void> = Promise.resolve();
  const abfragen = (apps?: readonly string[]) => {
    const naechste = laufend.then(() =>
      versionenAbfragen(deps, stand, apps ?? appsMitManifest(deps.db)),
    );
    laufend = naechste.catch(() => {});
    return naechste;
  };
  return { stand, abfragen };
};

export const versionsSchleife = (v: Versionen, planen: Planer, log: (z: string) => void): void => {
  const lauf = () => {
    v.abfragen().catch((fehler) =>
      log(JSON.stringify({ msg: "version query failed", fehler: String(fehler) })),
    );
  };
  lauf();
  planen(lauf, ABFRAGE_MS);
};

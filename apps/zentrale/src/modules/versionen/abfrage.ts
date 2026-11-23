import { randomUUID } from "node:crypto";
import { type Manifest, repositoryAusImage } from "@steuerzentrale/manifest";
import { tagesbeginn } from "@steuerzentrale/planung";
import { and, eq, gte } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { betreiber, ereignisse, manifeste } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import { neuestesManifestDerApp } from "../manifeste/index.ts";
import { type RegistryDeps, tagsAbfragen } from "./registry.ts";
import { type RegistryStand, type VersionsStand, versionenAusTags } from "./stand.ts";

/*
 * Asking the registries for new versions (BAULISTE.md Z-501; docs/plan.md, "Versionen aus den
 * Registries (Z-501)"): per app the image of its HTTP service, else of its first container, in the
 * newest imported manifest. A registry that fails makes the event `registry_fehler` (warn) for every
 * operator, since the manifests hold for all: once a day per app and operator (the day in
 * Europe/Berlin), whatever how often it fails that day.
 */

export const REGISTRY_FEHLER = "registry_fehler";

export type VersionenDeps = RegistryDeps & {
  db: Db;
  schreibDb: SchreibDb;
  now: () => number;
  log: (zeile: string) => void;
  neueId?: () => string;
};

/** The image the registry is asked about; undefined while the manifest names none yet */
export const imageDerApp = (m: Manifest): string | undefined => {
  const dienst = m.netz.http?.dienst;
  const container = m.container.find((c) => c.name === dienst) ?? m.container[0];
  return typeof container?.image === "string" ? container.image : undefined;
};

const ziel = (app: string) => `app:${app}`;

const heuteGemeldet = (db: Db, betreiberId: string, app: string, jetzt: number): boolean =>
  db
    .select({ id: ereignisse.ereignisId })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, betreiberId),
        eq(ereignisse.art, REGISTRY_FEHLER),
        eq(ereignisse.ziel, ziel(app)),
        gte(ereignisse.zeitpunkt, tagesbeginn(jetzt)),
      ),
    )
    .get() !== undefined;

/** The event for every operator that has none for this app today; returns how many */
export const registryFehlerMelden = (
  deps: VersionenDeps,
  app: string,
  fehler: string,
  jetzt: number,
): number => {
  const alle = deps.db.select({ id: betreiber.betreiberId }).from(betreiber).all();
  let gemeldet = 0;
  for (const { id: betreiberId } of alle) {
    if (heuteGemeldet(deps.db, betreiberId, app, jetzt)) continue;
    const kontext = { betreiberId, akteur: "system", jetzt, grund: "Registry nicht erreichbar" };
    schreiben(deps.schreibDb, kontext, "ereignis.registry-fehler", (w) =>
      w.einfuegen("ereignisse", {
        betreiberId,
        ereignisId: (deps.neueId ?? randomUUID)(),
        zeitpunkt: jetzt,
        art: REGISTRY_FEHLER,
        schwere: "warn",
        ziel: ziel(app),
        text: `Registry von ${app} gab keine Versionen: ${fehler}`.slice(0, 500),
      }),
    );
    gemeldet += 1;
  }
  return gemeldet;
};

/** Asks the registry of one app; a failure is kept with its reason and reported */
export const appAbfragen = async (deps: VersionenDeps, app: string): Promise<RegistryStand> => {
  const m = neuestesManifestDerApp(deps.db, app);
  const image = m ? imageDerApp(m) : undefined;
  const repo = image ? repositoryAusImage(image) : undefined;
  if (!repo) return { abgefragtAm: deps.now(), image: null, versionen: [], fehler: null };
  const tags = await tagsAbfragen(repo, deps);
  const stand: RegistryStand = {
    abgefragtAm: deps.now(),
    image: `${repo.registry}/${repo.name}`,
    versionen: tags.ok ? versionenAusTags(tags.tags) : [],
    fehler: tags.ok ? null : tags.fehler,
  };
  if (stand.fehler !== null) registryFehlerMelden(deps, app, stand.fehler, stand.abgefragtAm);
  return stand;
};

/** The apps with an imported manifest */
export const appsMitManifest = (db: Db): string[] =>
  db
    .selectDistinct({ app: manifeste.app })
    .from(manifeste)
    .all()
    .map((z) => z.app)
    .sort();

/** Asks the registries of `apps` (all with a manifest) one after the other, keeps what they say */
export const versionenAbfragen = async (
  deps: VersionenDeps,
  stand: VersionsStand,
  apps: readonly string[] = appsMitManifest(deps.db),
): Promise<void> => {
  for (const app of apps) {
    try {
      stand.setzen(app, await appAbfragen(deps, app));
    } catch (fehler) {
      deps.log(JSON.stringify({ msg: "version query failed", app, fehler: String(fehler) }));
    }
  }
};

import { type Manifest, manifestPruefen } from "@steuerzentrale/manifest";
import { versionVergleichen } from "@steuerzentrale/planung";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { manifeste } from "../../db/schema.ts";

/*
 * Reading the imported manifests (BAULISTE.md Z-501): they hold for every operator, so no read
 * filters by one; whose member imported one the routes decide to show (routes/manifeste.ts).
 */

export type ManifestEintrag = typeof manifeste.$inferSelect;

/** A manifest without its text and signature, as lists show it */
export type ManifestKopf = Omit<ManifestEintrag, "text" | "signatur">;

const KOPF = {
  app: manifeste.app,
  version: manifeste.version,
  sha256: manifeste.sha256,
  dringend: manifeste.dringend,
  importiertAm: manifeste.importiertAm,
  importiertVon: manifeste.importiertVon,
  importiertVonBetreiber: manifeste.importiertVonBetreiber,
};

export const manifestLesen = (db: Db, app: string, version: string): ManifestEintrag | undefined =>
  db
    .select()
    .from(manifeste)
    .where(and(eq(manifeste.app, app), eq(manifeste.version, version)))
    .get();

/** Every imported manifest without text, by app and then newest version first */
export const manifesteListe = (db: Db): ManifestKopf[] =>
  db
    .select(KOPF)
    .from(manifeste)
    .all()
    .sort((a, b) => a.app.localeCompare(b.app) || versionVergleichen(b.version, a.version));

/** The app's manifests without text, newest version first */
export const manifesteDerApp = (db: Db, app: string): ManifestKopf[] =>
  db
    .select(KOPF)
    .from(manifeste)
    .where(eq(manifeste.app, app))
    .all()
    .sort((a, b) => versionVergleichen(b.version, a.version));

/**
 * The app's manifest of the highest version, a pre-release before its release; it was checked when
 * it came, so one that no longer reads (a schema change) is passed over
 */
export const neuestesManifestDerApp = (db: Db, app: string): Manifest | undefined => {
  for (const kopf of manifesteDerApp(db, app)) {
    const eintrag = manifestLesen(db, app, kopf.version);
    const geprueft = eintrag ? manifestPruefen(eintrag.text) : undefined;
    if (geprueft?.ok) return geprueft.manifest;
  }
  return undefined;
};

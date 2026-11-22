import { type Manifest, manifestPruefen } from "@steuerzentrale/manifest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationen } from "../../db/schema.ts";

/*
 * The manifest the operator's values of an app are checked against (docs/plan.md, "Werte des
 * Betreibers schreiben"): until manifests are imported (Z-501) the Zentrale knows an app's manifest
 * only from its installations, each made with a signed one. The newest is the one of the highest
 * version, of two with the same version the one made last; installations of every state count,
 * since each manifest was checked with its signature when it came.
 */

const teile = (version: string): [number[], string | undefined] => {
  const [kern = "", vor] = version.split(/-(.*)/s);
  return [kern.split(".").map(Number), vor];
};

/** Semantic versions compared: major, minor, patch, and a pre-release before its release */
export const versionVergleichen = (a: string, b: string): number => {
  const [ka, va] = teile(a);
  const [kb, vb] = teile(b);
  for (let i = 0; i < 3; i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  if (va === vb) return 0;
  if (va === undefined) return 1;
  if (vb === undefined) return -1;
  return va.localeCompare(vb, "en", { numeric: true });
};

/** The newest manifest of the operator's installations of the app, or undefined without one */
export const neuestesManifest = (
  db: Db,
  betreiberId: string,
  app: string,
): Manifest | undefined => {
  const zeilen = db
    .select({
      version: installationen.version,
      manifest: installationen.manifest,
      angelegtAm: installationen.angelegtAm,
    })
    .from(installationen)
    .where(and(eq(installationen.betreiberId, betreiberId), eq(installationen.app, app)))
    .all()
    .sort((x, y) => versionVergleichen(y.version, x.version) || y.angelegtAm - x.angelegtAm);
  for (const z of zeilen) {
    const geprueft = manifestPruefen(z.manifest);
    if (geprueft.ok) return geprueft.manifest;
  }
  return undefined;
};

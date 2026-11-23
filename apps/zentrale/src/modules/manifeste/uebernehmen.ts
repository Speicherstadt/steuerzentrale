import type { OeffentlicherSchluessel } from "@steuerzentrale/manifest";
import { asc } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { installationen } from "../../db/schema.ts";
import { manifestImportieren, sha256 } from "./importieren.ts";
import { manifestLesen } from "./lesen.ts";

/*
 * The manifests of installations made before Z-501 (docs/plan.md, "Manifeste in der Zentrale
 * (Z-501)"): each installation keeps the manifest it was made with; a version missing in
 * `manifeste` is taken over from the installation made first with it, when its signature holds
 * with the Zentrale's key, at every start. Not in a migration: SQL can check neither the signature
 * nor read `dringend`. A second installation of the same version with another text keeps its own
 * and is not taken over (the first one stands); the audit entry goes to the installation's operator.
 */

export type Uebernahme = { uebernommen: number; abgelehnt: string[] };

export const manifesteUebernehmen = (
  d: { db: Db; schreibDb: SchreibDb },
  schluessel: OeffentlicherSchluessel,
  jetzt: number,
): Uebernahme => {
  const zeilen = d.db
    .select({
      betreiberId: installationen.betreiberId,
      installationId: installationen.installationId,
      app: installationen.app,
      version: installationen.version,
      manifest: installationen.manifest,
      signatur: installationen.signatur,
    })
    .from(installationen)
    .orderBy(asc(installationen.angelegtAm))
    .all();
  const ergebnis: Uebernahme = { uebernommen: 0, abgelehnt: [] };
  for (const z of zeilen) {
    const vorhanden = manifestLesen(d.db, z.app, z.version);
    if (vorhanden) {
      // the installation keeps its own text; the log names it at each start
      if (vorhanden.sha256 !== sha256(z.manifest))
        ergebnis.abgelehnt.push(`${z.installationId}: version_vergeben`);
      continue;
    }
    const kontext = {
      betreiberId: z.betreiberId,
      akteur: "system",
      jetzt,
      grund: `Manifest der Installation ${z.installationId} übernommen (Z-501)`,
    };
    const r = manifestImportieren(d, kontext, schluessel, z, "uebernommen");
    if (r.ok) ergebnis.uebernommen += 1;
    else ergebnis.abgelehnt.push(`${z.installationId}: ${r.grund}`);
  }
  return ergebnis;
};

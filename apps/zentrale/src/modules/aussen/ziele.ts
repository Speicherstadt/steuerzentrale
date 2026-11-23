import { manifestPruefen } from "@steuerzentrale/manifest";
import type { DnsSoll, Erwartung } from "@steuerzentrale/planung";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationen } from "../../db/schema.ts";
import { sollAus } from "../dns/plan.ts";
import type { Installation } from "../installationen/index.ts";
import { serverFakten, serverLesen } from "../server/index.ts";

/*
 * What the Zentrale checks from outside (BAULISTE.md Z-704; docs/plan.md, "Prüfung von außen"):
 * every running installation whose manifest has an HTTP service, so the Pforte routes its host.
 * The path is the manifest's health path when the check is `http` on that service and port (as
 * the agent checks it inside), else `/`, where any answer below 500 says the Pforte reached the
 * app. The addresses to expect are those the Zentrale set (modules/dns), only while it has set
 * them; a host the operator points himself is only resolved.
 */

export type Pruefziel = {
  installation: Installation;
  pfad: string;
  erwartung: Erwartung;
  soll: DnsSoll;
};

/** Path and what counts as healthy, or undefined for a manifest without an HTTP service */
export const pfadVon = (
  manifestText: string,
): { pfad: string; erwartung: Erwartung } | undefined => {
  const geprueft = manifestPruefen(manifestText);
  if (!geprueft.ok) return undefined;
  const { netz, health } = geprueft.manifest;
  if (netz.http === null) return undefined;
  const aufDemDienst =
    health.art === "http" &&
    health.dienst === netz.http.dienst &&
    (health.port === undefined || health.port === netz.http.port);
  return aufDemDienst
    ? { pfad: health.pfad, erwartung: "health" }
    : { pfad: "/", erwartung: "antwort" };
};

const sollVon = (db: Db, i: Installation): DnsSoll => {
  if (i.dns !== "gesetzt") return null;
  const sv = serverLesen(db, i.betreiberId, i.serverId);
  return sollAus(sv ? serverFakten(sv) : null);
};

/** Every installation to check now, of every operator */
export const pruefziele = (db: Db): Pruefziel[] =>
  db
    .select()
    .from(installationen)
    .where(eq(installationen.zustand, "laeuft"))
    .all()
    .flatMap((installation) => {
      const ziel = pfadVon(installation.manifest);
      return ziel ? [{ installation, ...ziel, soll: sollVon(db, installation) }] : [];
    });

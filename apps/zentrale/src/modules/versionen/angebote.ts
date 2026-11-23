import { type AngeboteneVersion, angeboteneVersionen } from "@steuerzentrale/planung";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationen, kunden } from "../../db/schema.ts";
import { manifesteListe } from "../manifeste/index.ts";

/*
 * The versions each installation of an operator is offered (BAULISTE.md Z-501, page "Updates"):
 * every imported manifest newer than its version, a pre-release only for an installation of an
 * internal customer (packages/planung, `angeboteneVersionen`, which Z-503 updates by too).
 */

export type InstallationsAngebot = {
  installationId: string;
  kundeId: string;
  app: string;
  version: string;
  /** Of an internal customer: in the wave "intern", offered pre-releases */
  intern: boolean;
  angeboten: AngeboteneVersion[];
};

export const angeboteFuer = (db: Db, betreiberId: string): InstallationsAngebot[] => {
  const nachApp = Map.groupBy(manifesteListe(db), (k) => k.app);
  return db
    .select({
      installationId: installationen.installationId,
      kundeId: installationen.kundeId,
      app: installationen.app,
      version: installationen.version,
      intern: kunden.intern,
    })
    .from(installationen)
    .innerJoin(
      kunden,
      and(
        eq(kunden.betreiberId, installationen.betreiberId),
        eq(kunden.kundeId, installationen.kundeId),
      ),
    )
    .where(and(eq(installationen.betreiberId, betreiberId), ne(installationen.zustand, "entfernt")))
    .all()
    .map((i) => ({ ...i, angeboten: angeboteneVersionen(i, nachApp.get(i.app) ?? []) }))
    .sort((a, b) => a.app.localeCompare(b.app) || a.installationId.localeCompare(b.installationId));
};

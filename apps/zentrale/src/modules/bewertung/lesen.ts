import type { Bewertungsstand, Grund } from "@steuerzentrale/planung";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { ereignisse, installationVerlauf } from "../../db/schema.ts";
import type { Installation } from "../installationen/index.ts";

/*
 * Reading ratings (BAULISTE.md Z-403), always within one operator: the current one stands at the
 * installation, its changes in `installation_verlauf`, its faults in the events.
 */

export const STOERUNG_ART = "stoerung";
export const BEHOBEN_ART = "stoerung_behoben";

/** The target of an installation's events */
export const zielVon = (installationId: string) => `installation:${installationId}`;

const grundLesen = (text: string | null): Grund => {
  const g = JSON.parse(text ?? "{}") as Partial<Grund>;
  return { code: g.code ?? "noch_keine_meldung", werte: g.werte ?? {} };
};

/** The rating as last stored, or null before the first report */
export const standVon = (i: Installation): Bewertungsstand | null =>
  i.bewertung === null || i.bewertungSeit === null || i.gemeldetAm === null
    ? null
    : {
        bewertung: i.bewertung,
        grund: grundLesen(i.bewertungGrund),
        seit: i.bewertungSeit,
        gemeldetAm: i.gemeldetAm,
      };

export type Verlaufseintrag = Pick<Bewertungsstand, "bewertung" | "grund"> & { zeitpunkt: number };

/** How many changes the page shows, newest first */
export const VERLAUF_MAX = 200;

export const verlaufLesen = (
  db: Db,
  betreiberId: string,
  installationId: string,
): Verlaufseintrag[] =>
  db
    .select()
    .from(installationVerlauf)
    .where(
      and(
        eq(installationVerlauf.betreiberId, betreiberId),
        eq(installationVerlauf.installationId, installationId),
      ),
    )
    .orderBy(desc(installationVerlauf.zeitpunkt))
    .limit(VERLAUF_MAX)
    .all()
    .map((z) => ({ zeitpunkt: z.zeitpunkt, bewertung: z.bewertung, grund: grundLesen(z.grund) }));

/** Whether the installation has a fault not yet fixed: its newest fault event is not a fix */
export const stoerungOffen = (db: Db, betreiberId: string, installationId: string): boolean =>
  db
    .select({ art: ereignisse.art })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, betreiberId),
        eq(ereignisse.ziel, zielVon(installationId)),
        inArray(ereignisse.art, [STOERUNG_ART, BEHOBEN_ART]),
      ),
    )
    // a fix never comes before its fault: in the same millisecond, "stoerung_behoben" sorts first
    .orderBy(desc(ereignisse.zeitpunkt), desc(ereignisse.art))
    .get()?.art === STOERUNG_ART;

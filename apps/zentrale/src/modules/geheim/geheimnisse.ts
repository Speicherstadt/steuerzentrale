import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { geheimnisse } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import type { Schreiber } from "../audit/index.ts";
import { type Entschluesselt, entschluesseln, verschluesseln } from "./verschluesseln.ts";

/** Binds a value to its operator and row, so it cannot be copied into another one */
export const geheimnisZweck = (betreiberId: string, geheimnisId: string): string =>
  `geheimnisse:${betreiberId}:${geheimnisId}`;

export type NeuesGeheimnis = {
  betreiberId: string;
  geheimnisId: string;
  zweck: string;
  klartext: string;
  jetzt: number;
};

/** Stores a secret encrypted with the current key, new or in place of the old value */
export const geheimnisSetzen = (
  schreiber: Schreiber,
  bund: Schluesselbund,
  db: Db,
  neu: NeuesGeheimnis,
): void => {
  const wert = verschluesseln(
    bund.aktuell,
    geheimnisZweck(neu.betreiberId, neu.geheimnisId),
    neu.klartext,
  );
  const vorhanden = db
    .select({ id: geheimnisse.geheimnisId })
    .from(geheimnisse)
    .where(
      and(
        eq(geheimnisse.betreiberId, neu.betreiberId),
        eq(geheimnisse.geheimnisId, neu.geheimnisId),
      ),
    )
    .get();
  if (vorhanden)
    schreiber.aendern(
      "geheimnisse",
      { geheimnisId: neu.geheimnisId },
      { wert, zweck: neu.zweck, geaendertAm: neu.jetzt },
    );
  else
    schreiber.einfuegen("geheimnisse", {
      betreiberId: neu.betreiberId,
      geheimnisId: neu.geheimnisId,
      zweck: neu.zweck,
      wert,
      geaendertAm: neu.jetzt,
    });
};

/** The plain text of an operator's secret; only the Zentrale reads it, never the API (CLAUDE.md) */
export const geheimnisLesen = (
  db: Db,
  bund: Schluesselbund,
  betreiberId: string,
  geheimnisId: string,
): Entschluesselt | { ok: false; grund: "fehlt" } => {
  const zeile = db
    .select({ wert: geheimnisse.wert })
    .from(geheimnisse)
    .where(and(eq(geheimnisse.betreiberId, betreiberId), eq(geheimnisse.geheimnisId, geheimnisId)))
    .get();
  if (!zeile) return { ok: false, grund: "fehlt" };
  return entschluesseln(
    [bund.aktuell, ...bund.alt],
    geheimnisZweck(betreiberId, geheimnisId),
    zeile.wert,
  );
};

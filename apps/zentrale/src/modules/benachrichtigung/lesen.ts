import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { empfaenger, ereignisse, zustellungen } from "../../db/schema.ts";

/*
 * The operator's newest deliveries for the settings' tab (BAULISTE.md Z-703): what was told to
 * whom, how often it was tried and why the last attempt failed; the recipient as the API shows it
 * (address or a webhook's origin), never its URL or key.
 */
export const ZUSTELLUNGEN_MAX = 20;

export type Zustellungseintrag = {
  zustellungId: string;
  ereignisText: string | null;
  empfaenger: string | null;
  schwere: string;
  zustand: "wartet" | "zugestellt" | "aufgegeben";
  versuche: number;
  fehler: string | null;
  angelegtAm: number;
  faelligAm: number;
  erledigtAm: number | null;
};

export const zustellungenLesen = (db: Db, betreiberId: string): Zustellungseintrag[] =>
  db
    .select({
      zustellungId: zustellungen.zustellungId,
      ereignisText: ereignisse.text,
      empfaenger: empfaenger.anzeige,
      schwere: zustellungen.schwere,
      zustand: zustellungen.zustand,
      versuche: zustellungen.versuche,
      fehler: zustellungen.fehler,
      angelegtAm: zustellungen.angelegtAm,
      faelligAm: zustellungen.faelligAm,
      erledigtAm: zustellungen.erledigtAm,
    })
    .from(zustellungen)
    .leftJoin(
      ereignisse,
      and(
        eq(ereignisse.betreiberId, zustellungen.betreiberId),
        eq(ereignisse.ereignisId, zustellungen.ereignisId),
      ),
    )
    .leftJoin(
      empfaenger,
      and(
        eq(empfaenger.betreiberId, zustellungen.betreiberId),
        eq(empfaenger.empfaengerId, zustellungen.empfaengerId),
      ),
    )
    .where(eq(zustellungen.betreiberId, betreiberId))
    .orderBy(desc(zustellungen.angelegtAm), desc(zustellungen.zustellungId))
    .limit(ZUSTELLUNGEN_MAX)
    .all();

import type { PruefRestoreTeil } from "@steuerzentrale/manifest";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { wiederherstellungen } from "../../db/schema.ts";
import { zustaendeLesen } from "../auftraege/lesen.ts";

/*
 * Reading restores (BAULISTE.md Z-603), always within one operator: the newest of an installation
 * with where it stands. Under way it is first backing up the current state (`sichern`), then playing
 * the run back (`zurueckspielen`); ended, it succeeded or failed with its reason.
 */

export type Phase = "sichern" | "zurueckspielen" | "gelungen" | "gescheitert";

export type Wiederherstellung = {
  angefordertAm: number;
  /** The chosen run's time */
  laufZeitpunkt: number;
  phase: Phase;
  endeAm: number | null;
  fehler: string | null;
  teile: PruefRestoreTeil[];
  dauerMs: number | null;
};

export type WiederherstellenStand = { letzter: Wiederherstellung | null; laeuft: boolean };

type Zeile = typeof wiederherstellungen.$inferSelect;

const phaseVon = (db: Db, z: Zeile): Phase => {
  if (z.endeAm !== null) return z.ok ? "gelungen" : "gescheitert";
  const backup = zustaendeLesen(db, z.betreiberId, [z.backupAuftragId]).get(z.backupAuftragId);
  return backup && ENDZUSTAENDE.has(backup) ? "zurueckspielen" : "sichern";
};

export const wiederherstellenStand = (
  db: Db,
  betreiberId: string,
  installationId: string,
): WiederherstellenStand => {
  const z = db
    .select()
    .from(wiederherstellungen)
    .where(
      and(
        eq(wiederherstellungen.betreiberId, betreiberId),
        eq(wiederherstellungen.installationId, installationId),
      ),
    )
    .orderBy(desc(wiederherstellungen.angefordertAm))
    .limit(1)
    .get();
  if (!z) return { letzter: null, laeuft: false };
  return {
    letzter: {
      angefordertAm: z.angefordertAm,
      laufZeitpunkt: z.laufZeitpunkt,
      phase: phaseVon(db, z),
      endeAm: z.endeAm,
      fehler: z.fehler,
      teile: JSON.parse(z.teile) as PruefRestoreTeil[],
      dauerMs: z.dauerMs,
    },
    laeuft: z.endeAm === null,
  };
};

import {
  AGENT_UPDATE_AKTION,
  SERVER_NEUSTART_AKTION,
  UPDATE_AKTION,
} from "@steuerzentrale/manifest";
import { versionVergleichen } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, updates } from "../../db/schema.ts";
import { zustaendeLesen } from "../auftraege/lesen.ts";

/*
 * Reading updates (BAULISTE.md Z-503), always within one operator: the newest of an installation
 * with where it stands (backing up first, then updating, then its end), whether a server has one
 * under way, and what the waves of a version know of the updates made to it.
 */

export type UpdateZeile = typeof updates.$inferSelect;

/** Under way: backing up the current state, then updating; ended: one of `UPDATE_ERGEBNISSE` */
export type UpdatePhase = "sichern" | "aktualisieren" | NonNullable<UpdateZeile["ergebnis"]>;

export type Update = {
  vonVersion: string;
  nachVersion: string;
  anlass: UpdateZeile["anlass"];
  welle: string | null;
  sperrzeitUebergangen: boolean;
  angefordertAm: number;
  phase: UpdatePhase;
  endeAm: number | null;
  fehler: string | null;
  dauerMs: number | null;
};

export type UpdateStand = { letzter: Update | null; laeuft: boolean };

/** The update this job belongs to, as its backup or as the update itself */
export const updateZu = (db: Db, betreiberId: string, auftragId: string): UpdateZeile | undefined =>
  db
    .select()
    .from(updates)
    .where(
      and(
        eq(updates.betreiberId, betreiberId),
        or(eq(updates.auftragId, auftragId), eq(updates.backupAuftragId, auftragId)),
      ),
    )
    .get();

const phaseVon = (db: Db, z: UpdateZeile): UpdatePhase => {
  if (z.ergebnis !== null) return z.ergebnis;
  const backup = zustaendeLesen(db, z.betreiberId, [z.backupAuftragId]).get(z.backupAuftragId);
  return backup && ENDZUSTAENDE.has(backup) ? "aktualisieren" : "sichern";
};

const alsUpdate = (db: Db, z: UpdateZeile): Update => ({
  vonVersion: z.vonVersion,
  nachVersion: z.nachVersion,
  anlass: z.anlass,
  welle: z.welle,
  sperrzeitUebergangen: z.sperrzeitUebergangen,
  angefordertAm: z.angefordertAm,
  phase: phaseVon(db, z),
  endeAm: z.endeAm,
  fehler: z.fehler,
  dauerMs: z.dauerMs,
});

export const updateStand = (db: Db, betreiberId: string, installationId: string): UpdateStand => {
  const z = db
    .select()
    .from(updates)
    .where(and(eq(updates.betreiberId, betreiberId), eq(updates.installationId, installationId)))
    .orderBy(desc(updates.angefordertAm))
    .limit(1)
    .get();
  return z
    ? { letzter: alsUpdate(db, z), laeuft: z.endeAm === null }
    : { letzter: null, laeuft: false };
};

/**
 * Whether an update job of the operator is open on the server: one at a time per server, the
 * update of its agent (Z-504) and a reboot of the server (Z-701) counted too
 */
export const updateAufServer = (db: Db, betreiberId: string, serverId: string): boolean =>
  db
    .select({ zustand: auftraege.zustand })
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, betreiberId),
        eq(auftraege.serverId, serverId),
        inArray(auftraege.aktion, [UPDATE_AKTION, AGENT_UPDATE_AKTION, SERVER_NEUSTART_AKTION]),
      ),
    )
    .all()
    .some((a) => !ENDZUSTAENDE.has(a.zustand));

/** The ends that halt the waves of their version: every one but `aktualisiert` and `abgebrochen` */
const STOERUNG: ReadonlySet<string> = new Set([
  "zurueckgenommen",
  "ruecknahme_unvollstaendig",
  "gescheitert",
]);

/** The operator's ended updates of the app, oldest end first */
const beendete = (db: Db, betreiberId: string, app: string): UpdateZeile[] =>
  db
    .select()
    .from(updates)
    .where(and(eq(updates.betreiberId, betreiberId), eq(updates.app, app)))
    .all()
    .filter((z) => z.endeAm !== null)
    .sort((a, b) => (a.endeAm ?? 0) - (b.endeAm ?? 0));

/**
 * What the waves of one version know (packages/planung, `Wellenstand`): when an update to it first
 * failed or was rolled back, and when the last internal installation reached it or a newer one
 */
export const wellenstandLesen = (
  db: Db,
  betreiberId: string,
  app: string,
  version: string,
  intern: ReadonlySet<string>,
): { stoerungAm?: number; internGelungenAm?: number } => {
  const alle = beendete(db, betreiberId, app);
  const stoerung = alle.find((z) => z.nachVersion === version && STOERUNG.has(z.ergebnis ?? ""));
  const gelungen = alle.filter(
    (z) =>
      z.ergebnis === "aktualisiert" &&
      intern.has(z.installationId) &&
      versionVergleichen(z.nachVersion, version) >= 0,
  );
  return {
    ...(stoerung?.endeAm ? { stoerungAm: stoerung.endeAm } : {}),
    ...(gelungen.at(-1)?.endeAm ? { internGelungenAm: gelungen.at(-1)?.endeAm as number } : {}),
  };
};

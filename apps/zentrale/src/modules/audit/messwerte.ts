import { and, eq, sql } from "drizzle-orm";
import type { SchreibDb } from "../../db/oeffnen.ts";
import {
  type AUSSEN_ZUSTAENDE,
  auftraege,
  aussenPruefungen,
  type BEWERTUNGEN,
  dienstInnen,
  dienstPruefungen,
  dienstVerfuegbarkeit,
  fakten,
  heartbeats,
  installationen,
  installationVerlauf,
  server,
  verfuegbarkeit,
} from "../../db/schema.ts";

/*
 * Measurements, the one write past the audit log besides the retention's own (docs/plan.md,
 * "Audit-Log"): a heartbeat every 30 seconds and the facts every 15 minutes per server are readings,
 * not actions of anyone, and an audit entry for each would bury the entries that matter; so is the
 * step a running job reports (Z-305), whose state changes go through `schreiben`, and the rating of
 * an installation with its history (Z-403), whose faults go through `schreiben`. Only the tables
 * and columns written here; so is the check from outside with its hourly count for the
 * availability (Z-704), whose events go through `schreiben`, and that of an observed service (Z-1101)
 * with the rating of its units inside (Z-1103). The rows are kept 30 days, the history
 * of ratings 90, the hourly counts 13 months
 * (src/modules/aufbewahrung), and deleting them goes through `schreiben` again.
 */
export type Heartbeat = typeof heartbeats.$inferInsert;

/** Appends a heartbeat; a second one of the same server in the same millisecond is dropped */
export const heartbeatAnfuegen = (schreibDb: SchreibDb, zeile: Heartbeat): void => {
  schreibDb.verbindung.insert(heartbeats).values(zeile).onConflictDoNothing().run();
};

export type FaktenZeile = typeof fakten.$inferInsert;

/**
 * Appends the facts to their history and sets them as the server's newest (`server.fakten`, the
 * only columns of `server` written here), in one transaction (Z-304)
 */
export const faktenAnfuegen = (schreibDb: SchreibDb, zeile: FaktenZeile): void => {
  schreibDb.verbindung.transaction((tx) => {
    tx.insert(fakten).values(zeile).onConflictDoNothing().run();
    tx.update(server)
      .set({ fakten: zeile.daten, faktenAm: zeile.zeitpunkt })
      .where(and(eq(server.betreiberId, zeile.betreiberId), eq(server.serverId, zeile.serverId)))
      .run();
  });
};

export type FortschrittZeile = {
  betreiberId: string;
  auftragId: string;
  schritt: string;
  zeitpunkt: number;
};

/**
 * Sets the step a running job last reported (Z-305): only the columns `fortschritt` and
 * `fortschritt_am` of `auftraege`, and only while the job runs
 */
export const fortschrittSetzen = (schreibDb: SchreibDb, zeile: FortschrittZeile): void => {
  schreibDb.verbindung
    .update(auftraege)
    .set({ fortschritt: zeile.schritt, fortschrittAm: zeile.zeitpunkt })
    .where(
      and(
        eq(auftraege.betreiberId, zeile.betreiberId),
        eq(auftraege.auftragId, zeile.auftragId),
        eq(auftraege.zustand, "laeuft"),
      ),
    )
    .run();
};

export type BewertungZeile = {
  betreiberId: string;
  installationId: string;
  bewertung: (typeof BEWERTUNGEN)[number];
  /** JSON `{ code, werte }` */
  grund: string;
  seit: number;
  gemeldetAm: number;
  /** JSON units and health of the last report */
  meldung: string | null;
  /** Whether the rating changed: then it is also a row of the history, at `seit` */
  wechsel: boolean;
};

/**
 * Sets an installation's current rating (Z-403), only its columns `bewertung`, `bewertung_grund`,
 * `bewertung_seit`, `gemeldet_am` and `meldung`, and appends a change to `installation_verlauf`, in
 * one transaction (docs/plan.md, "Zustand in der Zentrale")
 */
export const bewertungSetzen = (schreibDb: SchreibDb, z: BewertungZeile): void => {
  schreibDb.verbindung.transaction((tx) => {
    tx.update(installationen)
      .set({
        bewertung: z.bewertung,
        bewertungGrund: z.grund,
        bewertungSeit: z.seit,
        gemeldetAm: z.gemeldetAm,
        meldung: z.meldung,
      })
      .where(
        and(
          eq(installationen.betreiberId, z.betreiberId),
          eq(installationen.installationId, z.installationId),
        ),
      )
      .run();
    if (z.wechsel)
      tx.insert(installationVerlauf)
        .values({
          betreiberId: z.betreiberId,
          installationId: z.installationId,
          zeitpunkt: z.seit,
          bewertung: z.bewertung,
          grund: z.grund,
        })
        .onConflictDoNothing()
        .run();
  });
};

export type AussenZeile = {
  betreiberId: string;
  installationId: string;
  zustand: (typeof AUSSEN_ZUSTAENDE)[number];
  /** JSON `{ code, werte }` */
  grund: string;
  seit: number;
  geprueftAm: number;
  /** JSON of what each step answered */
  ergebnis: string;
};

/**
 * Keeps an installation's newest check from outside (Z-704) and counts it, red or not, into the
 * slice of its UTC hour (`stunde`), in one transaction (docs/plan.md, "Verfügbarkeit")
 */
export const aussenSetzen = (schreibDb: SchreibDb, z: AussenZeile, stunde: number): void => {
  const rot = z.zustand === "rot" ? 1 : 0;
  const { betreiberId, installationId } = z;
  schreibDb.verbindung.transaction((tx) => {
    tx.insert(aussenPruefungen)
      .values(z)
      .onConflictDoUpdate({
        target: [aussenPruefungen.betreiberId, aussenPruefungen.installationId],
        set: {
          zustand: z.zustand,
          grund: z.grund,
          seit: z.seit,
          geprueftAm: z.geprueftAm,
          ergebnis: z.ergebnis,
        },
      })
      .run();
    tx.insert(verfuegbarkeit)
      .values({ betreiberId, installationId, stunde, gemessen: 1, rot })
      .onConflictDoUpdate({
        target: [verfuegbarkeit.betreiberId, verfuegbarkeit.installationId, verfuegbarkeit.stunde],
        set: {
          gemessen: sql`${verfuegbarkeit.gemessen} + 1`,
          rot: sql`${verfuegbarkeit.rot} + ${rot}`,
        },
      })
      .run();
  });
};

export type DienstAussenZeile = Omit<AussenZeile, "installationId"> & { dienstId: string };

/**
 * Keeps an observed service's newest check from outside (Z-1101) and counts it into the slice of
 * its UTC hour, as `aussenSetzen` does for an installation
 */
export const dienstAussenSetzen = (
  schreibDb: SchreibDb,
  z: DienstAussenZeile,
  stunde: number,
): void => {
  const rot = z.zustand === "rot" ? 1 : 0;
  const { betreiberId, dienstId } = z;
  schreibDb.verbindung.transaction((tx) => {
    tx.insert(dienstPruefungen)
      .values(z)
      .onConflictDoUpdate({
        target: [dienstPruefungen.betreiberId, dienstPruefungen.dienstId],
        set: {
          zustand: z.zustand,
          grund: z.grund,
          seit: z.seit,
          geprueftAm: z.geprueftAm,
          ergebnis: z.ergebnis,
        },
      })
      .run();
    tx.insert(dienstVerfuegbarkeit)
      .values({ betreiberId, dienstId, stunde, gemessen: 1, rot })
      .onConflictDoUpdate({
        target: [
          dienstVerfuegbarkeit.betreiberId,
          dienstVerfuegbarkeit.dienstId,
          dienstVerfuegbarkeit.stunde,
        ],
        set: {
          gemessen: sql`${dienstVerfuegbarkeit.gemessen} + 1`,
          rot: sql`${dienstVerfuegbarkeit.rot} + ${rot}`,
        },
      })
      .run();
  });
};

export type DienstInnenZeile = typeof dienstInnen.$inferInsert;

/** The newest rating inside of an observed service's units (Z-1103), one row per service */
export const dienstInnenSetzen = (schreibDb: SchreibDb, z: DienstInnenZeile): void => {
  schreibDb.verbindung
    .insert(dienstInnen)
    .values(z)
    .onConflictDoUpdate({
      target: [dienstInnen.betreiberId, dienstInnen.dienstId],
      set: {
        bewertung: z.bewertung,
        grund: z.grund,
        seit: z.seit,
        gemeldetAm: z.gemeldetAm,
        meldung: z.meldung,
      },
    })
    .run();
};

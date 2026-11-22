import { and, eq } from "drizzle-orm";
import type { SchreibDb } from "../../db/oeffnen.ts";
import {
  auftraege,
  type BEWERTUNGEN,
  fakten,
  heartbeats,
  installationen,
  installationVerlauf,
  server,
} from "../../db/schema.ts";

/*
 * Measurements, the one write past the audit log besides the retention's own (docs/plan.md,
 * "Audit-Log"): a heartbeat every 30 seconds and the facts every 15 minutes per server are readings,
 * not actions of anyone, and an audit entry for each would bury the entries that matter; so is the
 * step a running job reports (Z-305), whose state changes go through `schreiben`, and the rating of
 * an installation with its history (Z-403), whose faults go through `schreiben`. Only the tables
 * and columns written here; the rows are kept 30 days, the history of ratings 90
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

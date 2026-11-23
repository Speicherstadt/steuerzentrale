import type { PruefRestoreTeil } from "@steuerzentrale/manifest";
import { PRUEF_RESTORE_AKTION } from "@steuerzentrale/manifest";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, backups, pruefRestores } from "../../db/schema.ts";
import type { Installation } from "../installationen/lesen.ts";

/*
 * Reading test restores (BAULISTE.md Z-602), always within one operator: the newest of an
 * installation, whether one is under way, and whether the installation needs attention for it
 * (the newest failed, or none for 8 days, counted from its first successful backup when it never
 * had one).
 */

export const PRUEF_RESTORE_ALT_MS = 8 * 24 * 60 * 60_000;

export type PruefRestore = {
  zeitpunkt: number;
  ok: boolean;
  grund: string | null;
  kopie: string;
  teile: PruefRestoreTeil[];
  dauerMs: number | null;
};

export type PruefRestoreStand = { letzter: PruefRestore | null; laeuft: boolean };

export const letzterPruefRestore = (
  db: Db,
  betreiberId: string,
  installationId: string,
): PruefRestore | null => {
  const z = db
    .select()
    .from(pruefRestores)
    .where(
      and(
        eq(pruefRestores.betreiberId, betreiberId),
        eq(pruefRestores.installationId, installationId),
      ),
    )
    .orderBy(desc(pruefRestores.zeitpunkt))
    .limit(1)
    .get();
  return z
    ? {
        zeitpunkt: z.zeitpunkt,
        ok: z.ok,
        grund: z.grund,
        kopie: z.kopie,
        teile: JSON.parse(z.teile) as PruefRestoreTeil[],
        dauerMs: z.dauerMs,
      }
    : null;
};

const laeuftGerade = (db: Db, betreiberId: string, installationId: string): boolean =>
  db
    .select({ zustand: auftraege.zustand })
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, betreiberId),
        eq(auftraege.installationId, installationId),
        eq(auftraege.aktion, PRUEF_RESTORE_AKTION),
      ),
    )
    .all()
    .some((a) => !ENDZUSTAENDE.has(a.zustand));

export const pruefRestoreStand = (
  db: Db,
  betreiberId: string,
  installationId: string,
): PruefRestoreStand => ({
  letzter: letzterPruefRestore(db, betreiberId, installationId),
  laeuft: laeuftGerade(db, betreiberId, installationId),
});

const ersterErfolg = (db: Db, i: Installation): number | undefined =>
  db
    .select({ zeitpunkt: backups.zeitpunkt })
    .from(backups)
    .where(
      and(
        eq(backups.betreiberId, i.betreiberId),
        eq(backups.installationId, i.installationId),
        eq(backups.ok, true),
      ),
    )
    .orderBy(asc(backups.zeitpunkt))
    .limit(1)
    .get()?.zeitpunkt;

export type PruefRestoreAufmerksamkeit = {
  gescheitert: boolean;
  grund: string | null;
  seit: number | null;
};

/**
 * Why a running installation with backups needs attention for its test restore: the newest failed,
 * or it is older than 8 days (none at all, once its first successful backup is that old)
 */
export const pruefRestoreAufmerksamkeit = (
  db: Db,
  i: Installation,
  jetzt: number,
): PruefRestoreAufmerksamkeit | undefined => {
  const letzter = letzterPruefRestore(db, i.betreiberId, i.installationId);
  if (letzter && !letzter.ok)
    return { gescheitert: true, grund: letzter.grund, seit: letzter.zeitpunkt };
  const ab = letzter?.zeitpunkt ?? ersterErfolg(db, i);
  if (ab === undefined || jetzt - ab <= PRUEF_RESTORE_ALT_MS) return undefined;
  return { gescheitert: false, grund: null, seit: letzter?.zeitpunkt ?? null };
};

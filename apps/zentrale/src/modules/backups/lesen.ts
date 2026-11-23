import { manifestPruefen } from "@steuerzentrale/manifest";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { backups } from "../../db/schema.ts";
import { type Installation, installationenListe } from "../installationen/lesen.ts";
import { kundenListe } from "../kunden/index.ts";
import { type PruefRestoreStand, pruefRestoreStand } from "../pruef-restore/lesen.ts";
import { serverListe } from "../server/index.ts";
import { type WiederherstellenStand, wiederherstellenStand } from "../wiederherstellen/lesen.ts";
import { backupEingerichtet } from "./auftraege.ts";
import { zugangLesen } from "./zugaenge.ts";

/*
 * Reading backups (BAULISTE.md Z-601), always within one operator: per installation the parts its
 * manifest names, where its own S3 access stands, whether its backups are set up on the server, the
 * runs its agent reported, newest first, each with the id a restore names it by, its newest test
 * restore (Z-602) and its newest restore (Z-603). Nothing secret: no access, no password, no
 * repository.
 */

/** How many runs the page of an installation shows */
export const LAEUFE_MAX = 100;

export type Teil = { art: "pg_dump" | "volume" | "befehl"; name: string };
export type Lauf = {
  /** What `POST …/wiederherstellen` names the run by (Z-603) */
  id: string;
  zeitpunkt: number;
  ok: boolean;
  grund: string | null;
  teile: { tag: string; ok: boolean; snapshot?: string; fehler?: string }[];
};

export type BackupsDerInstallation = {
  installationId: string;
  teile: Teil[];
  zugang: "anlegen" | "angelegt" | "loeschen" | "geloescht" | null;
  eingerichtet: boolean;
  laeufe: Lauf[];
  pruefRestore: PruefRestoreStand;
  wiederherstellen: WiederherstellenStand;
};

/** The parts the installation's manifest backs up, each with what it names */
export const teileVon = (manifest: string): Teil[] => {
  const m = manifestPruefen(manifest);
  if (!m.ok) return [];
  return m.manifest.backup.map((t) => ({
    art: t.art,
    name: t.art === "pg_dump" ? t.container : t.art === "volume" ? t.volume : t.befehl,
  }));
};

const laeufeVon = (db: Db, betreiberId: string, installationId: string, max: number): Lauf[] =>
  db
    .select()
    .from(backups)
    .where(and(eq(backups.betreiberId, betreiberId), eq(backups.installationId, installationId)))
    .orderBy(desc(backups.zeitpunkt))
    .limit(max)
    .all()
    .map((b) => ({
      id: b.backupId,
      zeitpunkt: b.zeitpunkt,
      ok: b.ok,
      grund: b.grund,
      teile: JSON.parse(b.teile) as Lauf["teile"],
    }));

const stand = (db: Db, i: Installation, max: number): BackupsDerInstallation => ({
  installationId: i.installationId,
  teile: teileVon(i.manifest),
  zugang: zugangLesen(db, i.betreiberId, i.installationId)?.zustand ?? null,
  eingerichtet: backupEingerichtet(db, i.betreiberId, i.installationId),
  laeufe: laeufeVon(db, i.betreiberId, i.installationId, max),
  pruefRestore: pruefRestoreStand(db, i.betreiberId, i.installationId),
  wiederherstellen: wiederherstellenStand(db, i.betreiberId, i.installationId),
});

export const backupsDerInstallation = (db: Db, i: Installation): BackupsDerInstallation =>
  stand(db, i, LAEUFE_MAX);

/** The newest successful run's time */
const letzterErfolg = (db: Db, i: Installation): number | null =>
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
    .orderBy(desc(backups.zeitpunkt))
    .limit(1)
    .get()?.zeitpunkt ?? null;

export type UebersichtZeile = Omit<BackupsDerInstallation, "laeufe"> & {
  app: string;
  kundeId: string;
  kundeName: string;
  serverId: string;
  serverName: string;
  zustand: Installation["zustand"];
  letzter: Lauf | null;
  letzterErfolg: number | null;
};

/** The page "Backups": every installation not removed, with its last run */
export const backupUebersicht = (db: Db, betreiberId: string): UebersichtZeile[] => {
  const kunden = new Map(kundenListe(db, betreiberId).map((k) => [k.id, k.name]));
  const server = new Map(serverListe(db, betreiberId).map((s) => [s.serverId, s.name]));
  return installationenListe(db, betreiberId)
    .filter((i) => i.zustand !== "entfernt")
    .map((i) => {
      const { laeufe, ...rest } = stand(db, i, 1);
      return {
        ...rest,
        app: i.app,
        kundeId: i.kundeId,
        kundeName: kunden.get(i.kundeId) ?? i.kundeId,
        serverId: i.serverId,
        serverName: server.get(i.serverId) ?? i.serverId,
        zustand: i.zustand,
        letzter: laeufe[0] ?? null,
        letzterErfolg: letzterErfolg(db, i),
      };
    });
};

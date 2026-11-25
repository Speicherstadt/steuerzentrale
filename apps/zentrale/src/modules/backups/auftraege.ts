import {
  BACKUP_AKTIONEN,
  type BackupZugang,
  WIEDERHERSTELLEN_AKTION,
} from "@steuerzentrale/manifest";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { auftragEinfuegen, auftragVorbereiten, type Vorbereitet } from "../auftraege/anlegen.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import type { Installation } from "../installationen/lesen.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { zugangLesen } from "./zugaenge.ts";

/*
 * The backup jobs of an installation (BAULISTE.md Z-601; docs/plan.md, "Backup auf dem Server
 * (Z-601)"): `installation_backup_einrichten` once its access is made at MinIO (abgleich.ts), and
 * `installation_backup` for "Backup jetzt", with a reason, by the owner: only for a running
 * installation whose backups are set up, and not while a backup job of it is open, nor while a
 * restore of it is (Z-603): a backup then would keep half-restored data. Both carry the
 * installation's signed manifest; the field `backup` goes in only when the job is sent.
 */

type BackupAktion = (typeof BACKUP_AKTIONEN)[keyof typeof BACKUP_AKTIONEN];

/** The job, checked and unwritten; for setting up with the field it will carry, to check its shape */
export const backupAuftragVorbereiten = (
  deps: AuftragDeps,
  kontext: Kontext,
  i: Installation,
  aktion: BackupAktion,
  backup?: BackupZugang,
): Vorbereitet =>
  auftragVorbereiten(deps, kontext, {
    serverId: i.serverId,
    installationId: i.installationId,
    aktion,
    argumente: {},
    manifest: i.manifest,
    signatur: i.signatur,
    ...(backup ? { backup } : {}),
  });

const backupAuftraege = (
  db: Db,
  betreiberId: string,
  installationId: string,
  aktionen: readonly string[] = Object.values(BACKUP_AKTIONEN),
) =>
  db
    .select()
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, betreiberId),
        eq(auftraege.installationId, installationId),
        inArray(auftraege.aktion, [...aktionen]),
      ),
    )
    .all();

/**
 * When the installation's backups were set up: its access made, the job that set it up done (the
 * newest such job's end); undefined while they are not
 */
export const backupEingerichtetAm = (
  db: Db,
  betreiberId: string,
  installationId: string,
): number | undefined => {
  if (zugangLesen(db, betreiberId, installationId)?.zustand !== "angelegt") return undefined;
  const fertig = backupAuftraege(db, betreiberId, installationId, [BACKUP_AKTIONEN.einrichten])
    .filter((a) => a.zustand === "erfolgreich")
    .map((a) => a.geaendertAm);
  return fertig.length > 0 ? Math.max(...fertig) : undefined;
};

/** Whether the installation's backups are set up: its access made, the job that set it up done */
export const backupEingerichtet = (db: Db, betreiberId: string, installationId: string): boolean =>
  backupEingerichtetAm(db, betreiberId, installationId) !== undefined;

export type BackupAusgeloest =
  | { ok: true; auftrag: Auftrag }
  | {
      ok: false;
      grund:
        | "grund_fehlt"
        | "keine_installation"
        | "laeuft_nicht"
        | "nicht_eingerichtet"
        | "backup_laeuft"
        | "auftrag_offen"
        | "nicht_ausfuehrbar";
      detail?: string;
    };

/** "Backup jetzt": the job `installation_backup` of a running installation set up for backups */
export const backupJetzt = (
  deps: AuftragDeps,
  kontext: Kontext,
  installationId: string,
): BackupAusgeloest => {
  if (kontext.grund.trim() === "") return { ok: false, grund: "grund_fehlt" };
  const { betreiberId } = kontext;
  const i = installationLesen(deps.db, betreiberId, installationId);
  if (!i) return { ok: false, grund: "keine_installation" };
  if (i.zustand !== "laeuft") return { ok: false, grund: "laeuft_nicht" };
  if (!backupEingerichtet(deps.db, betreiberId, installationId))
    return { ok: false, grund: "nicht_eingerichtet" };
  const offen = backupAuftraege(deps.db, betreiberId, installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );
  if (offen) return { ok: false, grund: "backup_laeuft" };
  const wiederherstellen = backupAuftraege(deps.db, betreiberId, installationId, [
    WIEDERHERSTELLEN_AKTION,
  ]).some((a) => !ENDZUSTAENDE.has(a.zustand));
  if (wiederherstellen) return { ok: false, grund: "auftrag_offen" };
  const vorbereitet = backupAuftragVorbereiten(deps, kontext, i, BACKUP_AKTIONEN.jetzt);
  if (!vorbereitet.ok)
    return {
      ok: false,
      grund: "nicht_ausfuehrbar",
      detail: vorbereitet.detail ?? vorbereitet.grund,
    };
  const auftrag = schreiben(deps.schreibDb, kontext, "installation.backup", (w) =>
    auftragEinfuegen(w, vorbereitet.zeile),
  );
  zustellen(deps, [auftrag]);
  return { ok: true, auftrag: auftragLesen(deps.db, betreiberId, auftrag.auftragId) ?? auftrag };
};

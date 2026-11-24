import { type Antwort, api } from "../anmeldung/api.ts";
import { demoBackups } from "../demo/backups.ts";

/*
 * Backups (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und Zugang je Installation (Z-601)", "Backup
 * auf dem Server (Z-601)"), as the Zentrale's API answers (apps/zentrale, routes/backups.ts): the
 * operator's S3 target with its admin access only as set, the backups of every installation for
 * the page "Backups", those of one installation with its runs, its newest test restore (Z-602) and
 * its newest restore (Z-603), "Backup jetzt", "Prüf-Restore jetzt" and restoring a run. Signed in
 * the API, else the demo in memory.
 */

export type BackupZiel = {
  endpunkt: string | null;
  region: string | null;
  bucket: string | null;
  zugangGesetzt: boolean;
};

/** What the form sends; access key and secret key go together, left out they stay */
export type BackupZielAenderung = {
  endpunkt: string;
  region: string;
  bucket: string;
  accessKey?: string;
  secretKey?: string;
};

/** A part the manifest backs up, with the container, volume or command it names */
export type BackupTeil = { art: "pg_dump" | "volume" | "befehl"; name: string };

/**
 * A part of a run: its restic tag and snapshot, or why it failed; `bytes` what restic read for it,
 * as an agent since Z-804 reports it (an older one leaves it out)
 */
export type LaufTeil = {
  tag: string;
  ok: boolean;
  snapshot?: string;
  bytes?: number;
  fehler?: string;
};

/** The size of a run: the bytes of its parts, or null when a part has none to say */
export const laufBytes = (lauf: Pick<BackupLauf, "ok" | "teile">): number | null => {
  if (!lauf.ok || lauf.teile.length === 0) return null;
  const bytes = lauf.teile.map((t) => t.bytes);
  return bytes.every((b) => b !== undefined) ? bytes.reduce((s, b) => s + b, 0) : null;
};

/** One run as the agent reported it, with the id a restore names it by */
export type BackupLauf = {
  id: string;
  zeitpunkt: number;
  ok: boolean;
  grund: string | null;
  teile: LaufTeil[];
};

/** A part of a test restore: the snapshot it read, or why it was not restored */
export type PruefRestoreTeil = {
  tag: string;
  snapshot: string | null;
  zurueckgespielt: boolean;
  grund: string | null;
};

/** A test restore as the Zentrale kept it (apps/zentrale, modules/pruef-restore/lesen.ts) */
export type PruefRestoreLauf = {
  zeitpunkt: number;
  ok: boolean;
  grund: string | null;
  kopie: string;
  teile: PruefRestoreTeil[];
  dauerMs: number | null;
};

/** The newest test restore and whether one is under way */
export type PruefRestoreStand = { letzter: PruefRestoreLauf | null; laeuft: boolean };

/**
 * Where a restore stands (apps/zentrale, modules/wiederherstellen/lesen.ts): backing up the current
 * state, playing the run back, or ended
 */
export type WiederherstellenPhase = "sichern" | "zurueckspielen" | "gelungen" | "gescheitert";

export type Wiederherstellung = {
  angefordertAm: number;
  laufZeitpunkt: number;
  phase: WiederherstellenPhase;
  endeAm: number | null;
  fehler: string | null;
  teile: PruefRestoreTeil[];
  dauerMs: number | null;
};

/** The newest restore and whether it is under way */
export type WiederherstellenStand = { letzter: Wiederherstellung | null; laeuft: boolean };

export type ZugangsZustand = "anlegen" | "angelegt" | "loeschen" | "geloescht";

export type BackupsDerInstallation = {
  installationId: string;
  teile: BackupTeil[];
  zugang: ZugangsZustand | null;
  eingerichtet: boolean;
  laeufe: BackupLauf[];
  pruefRestore: PruefRestoreStand;
  wiederherstellen: WiederherstellenStand;
};

/** A line of the page "Backups" */
export type BackupZeile = Omit<BackupsDerInstallation, "laeufe"> & {
  app: string;
  kundeId: string;
  kundeName: string;
  serverId: string;
  serverName: string;
  zustand: "wird_eingerichtet" | "laeuft" | "gescheitert" | "entfernt";
  letzter: BackupLauf | null;
  letzterErfolg: number | null;
};

export type BackupAuftrag = { auftragId: string; aktion: string; zustand: string };

/** The two jobs of a restore: the backup of the current state, the restore waiting for it */
export type WiederherstellenAuftraege = { backup: BackupAuftrag; wiederherstellen: BackupAuftrag };

export type BackupQuelle = {
  ziel: () => Promise<Antwort<BackupZiel>>;
  zielSetzen: (neu: BackupZielAenderung, grund: string) => Promise<Antwort<BackupZiel>>;
  uebersicht: () => Promise<Antwort<BackupZeile[]>>;
  derInstallation: (id: string) => Promise<Antwort<BackupsDerInstallation>>;
  jetzt: (id: string, grund: string) => Promise<Antwort<BackupAuftrag>>;
  pruefRestore: (id: string, grund: string) => Promise<Antwort<BackupAuftrag>>;
  wiederherstellen: (
    id: string,
    lauf: string,
    grund: string,
  ) => Promise<Antwort<WiederherstellenAuftraege>>;
};

const pfad = (id: string) => `/api/v1/installationen/${encodeURIComponent(id)}`;

export const apiBackups: BackupQuelle = {
  ziel: () => api<BackupZiel>("/api/v1/backup-ziel"),
  zielSetzen: (neu, grund) =>
    api<BackupZiel>("/api/v1/backup-ziel", { method: "PUT", body: { ...neu, grund } }),
  uebersicht: async () => {
    const a = await api<{ installationen: BackupZeile[] }>("/api/v1/backups");
    return a.ok ? { ...a, daten: a.daten.installationen } : a;
  },
  derInstallation: (id) => api<BackupsDerInstallation>(`${pfad(id)}/backups`),
  jetzt: async (id, grund) => {
    const a = await api<{ auftrag: BackupAuftrag }>(`${pfad(id)}/backup`, { body: { grund } });
    return a.ok ? { ...a, daten: a.daten.auftrag } : a;
  },
  pruefRestore: async (id, grund) => {
    const a = await api<{ auftrag: BackupAuftrag }>(`${pfad(id)}/pruef-restore`, {
      body: { grund },
    });
    return a.ok ? { ...a, daten: a.daten.auftrag } : a;
  },
  wiederherstellen: (id, lauf, grund) =>
    api<WiederherstellenAuftraege>(`${pfad(id)}/wiederherstellen`, { body: { lauf, grund } }),
};

let quelle: BackupQuelle = demoBackups();

export const backupQuelle = (): BackupQuelle => quelle;

export const backupQuelleEinsetzen = (neu: BackupQuelle): void => {
  quelle = neu;
};

import { type Antwort, api } from "../anmeldung/api.ts";
import { demoBackups } from "../demo/backups.ts";

/*
 * Backups (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und Zugang je Installation (Z-601)", "Backup
 * auf dem Server (Z-601)"), as the Zentrale's API answers (apps/zentrale, routes/backups.ts): the
 * operator's S3 target with its admin access only as set, the backups of every installation for
 * the page "Backups", those of one installation with its runs, and "Backup jetzt". Signed in the
 * API, else the demo in memory.
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

/** One run as the agent reported it */
export type BackupLauf = {
  zeitpunkt: number;
  ok: boolean;
  grund: string | null;
  teile: { tag: string; snapshotId: string }[];
};

export type ZugangsZustand = "anlegen" | "angelegt" | "loeschen" | "geloescht";

export type BackupsDerInstallation = {
  installationId: string;
  teile: BackupTeil[];
  zugang: ZugangsZustand | null;
  eingerichtet: boolean;
  laeufe: BackupLauf[];
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

export type BackupQuelle = {
  ziel: () => Promise<Antwort<BackupZiel>>;
  zielSetzen: (neu: BackupZielAenderung, grund: string) => Promise<Antwort<BackupZiel>>;
  uebersicht: () => Promise<Antwort<BackupZeile[]>>;
  derInstallation: (id: string) => Promise<Antwort<BackupsDerInstallation>>;
  jetzt: (id: string, grund: string) => Promise<Antwort<BackupAuftrag>>;
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
};

let quelle: BackupQuelle = demoBackups();

export const backupQuelle = (): BackupQuelle => quelle;

export const backupQuelleEinsetzen = (neu: BackupQuelle): void => {
  quelle = neu;
};

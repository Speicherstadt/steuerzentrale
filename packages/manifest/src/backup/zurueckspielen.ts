import type { Manifest } from "../schema.ts";
import { backupTeile } from "./auftraege.ts";

/*
 * Playing a backup back (BAULISTE.md Z-602; docs/plan.md, "Prüf-Restore auf dem Server"): the parts
 * of the signed manifest's `backup` as the agent plays them back into an installation, the copy of
 * a test restore (backup/pruef-restore.ts) or, with Z-603, the installation itself. A volume goes
 * into the target's volume of the same name, which its Quadlet unit creates; a dump into pg_restore
 * once only its database container runs; a command's export is never played back. Nothing comes
 * from a job. Pure.
 */

/** The copy must be healthy within this time once its units started */
export const PRUEF_RESTORE_HEALTH_S = 300;

/** A part of the manifest's `backup` as it is played back into an installation */
export type RestoreTeil =
  | {
      art: "volume";
      tag: string;
      /** The target's Podman volume, `<installation>-<volume>` */
      volume: string;
      /** The volume's folder in the snapshot (backupTeile, SICHERUNG_PFAD) */
      pfad: string;
      /** The service Quadlet makes of the target's `.volume`, which creates the volume */
      unit: string;
    }
  | {
      art: "pg_dump";
      tag: string;
      /** The target's database container and its service */
      container: string;
      unit: string;
      /** The dump's file in the snapshot */
      datei: string;
      /** pg_restore on standard input; -d and -U take the next word whatever it is */
      argv: string[];
      /**
       * Ready once the server answers on TCP: the image's entrypoint runs its first start on the
       * socket only (`listen_addresses=''`), so the socket may answer before the server stays up
       */
      bereit: string[];
    }
  /** A command's output is an export, not a restore: never played back, named in the result */
  | { art: "befehl"; tag: string };

export type RestoreTeile =
  | { ok: true; netz: { name: string; unit: string }; teile: RestoreTeil[] }
  | { ok: false; grund: string };

/** The parts of the signed manifest's `backup` as they are played back into `ziel`, in order */
export const restoreTeile = (m: Manifest, ziel: string): RestoreTeile => {
  const b = backupTeile(m, ziel);
  if (!b.ok) return b;
  const teile = b.teile.map((t, i): RestoreTeil => {
    const quelle = m.backup[i];
    if (t.art === "volume")
      return {
        art: "volume",
        tag: t.tag,
        volume: t.volume,
        pfad: t.pfad,
        unit: `${t.volume}-volume.service`,
      };
    if (t.art === "befehl" || quelle?.art !== "pg_dump") return { art: "befehl", tag: t.tag };
    const wer = ["-d", quelle.datenbank, "-U", quelle.nutzer];
    return {
      art: "pg_dump",
      tag: t.tag,
      container: t.container,
      unit: `${t.container}.service`,
      datei: `/${t.dateiname}`,
      argv: ["pg_restore", "--clean", "--if-exists", ...wer],
      bereit: ["pg_isready", "-h", "127.0.0.1", ...wer],
    };
  });
  return { ok: true, netz: { name: ziel, unit: `${ziel}-network.service` }, teile };
};

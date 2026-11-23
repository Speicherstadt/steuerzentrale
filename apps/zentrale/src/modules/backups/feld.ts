import { type BackupFeld, backupPraefix, backupRepository } from "@steuerzentrale/manifest";
import type { Db } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { backupZielLesen } from "./ziel.ts";
import { type ZugangGeheim, zugangGeheim, zugangLesen } from "./zugaenge.ts";

/*
 * The field `backup` of the job `installation_backup_einrichten` (BAULISTE.md Z-601; docs/plan.md,
 * "Backup auf dem Server (Z-601)"): put together only when the job is sent (modules/auftraege,
 * zustellen.ts), from the operator's S3 target and the installation's encrypted access; the job's
 * row and the audit log never hold it. Only for an installation that stands on the server the job
 * goes to: a server gets the password of its own installations, never of another's.
 */

export type FeldGelesen = { ok: true; backup: BackupFeld } | { ok: false; grund: string };

/** The field from the target's endpoint and bucket, the installation's prefix and its secrets */
export const feldAus = (
  endpunkt: string,
  bucket: string,
  praefix: string,
  g: ZugangGeheim,
): BackupFeld => ({
  repository: backupRepository(endpunkt, bucket, praefix),
  zugang: { accessKey: g.accessKey, secretKey: g.secretKey },
  passwort: g.passwort,
});

export const backupFeldFuer = (
  deps: { db: Db; schluessel: Schluesselbund },
  betreiberId: string,
  installationId: string | null,
  serverId: string,
): FeldGelesen => {
  const i =
    installationId === null ? undefined : installationLesen(deps.db, betreiberId, installationId);
  if (!i) return { ok: false, grund: `no installation ${installationId}` };
  if (i.serverId !== serverId)
    return { ok: false, grund: `${i.installationId} does not stand on server ${serverId}` };
  const z = zugangLesen(deps.db, betreiberId, i.installationId);
  if (z?.zustand !== "angelegt")
    return { ok: false, grund: `${i.installationId} has no backup access made` };
  const ziel = backupZielLesen(deps.db, betreiberId);
  if (!ziel.endpunkt || !ziel.bucket) return { ok: false, grund: "no S3 target set" };
  const ort = backupPraefix({ bucket: ziel.bucket, betreiberId, installationId: i.installationId });
  if (!ort.ok) return ort;
  const g = zugangGeheim(deps.schluessel, z);
  if (!g.ok) return g;
  return { ok: true, backup: feldAus(ziel.endpunkt, ziel.bucket, ort.praefix, g.geheim) };
};

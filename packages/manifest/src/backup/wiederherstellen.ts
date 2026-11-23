import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import type { Manifest } from "../schema.ts";
import { BACKUP_ZEITLIMIT_S } from "./auftraege.ts";
import { type PruefRestoreDaten, pruefRestoreDatenLesen } from "./pruef-restore.ts";
import { type RestoreTeil, restoreTeile } from "./zurueckspielen.ts";

/*
 * Restoring an installation from a run of its backup (BAULISTE.md Z-603; docs/plan.md,
 * "Wiederherstellen (Z-603)", "Wiederherstellen auf dem Server (Z-603)"): built into the
 * Steuerzentrale like the backup jobs, with a fixed shape. The job names the installation
 * (`installationId`) and, for each part of the signed manifest's `backup` that is played back
 * (`volume`, `pg_dump`), the snapshot of the chosen run as the argument `snapshot:<tag>`, 64 hex
 * characters. A command's export is never played back, so it takes no argument. Flat string
 * arguments fit the protocol's `argumente` as they are; the tag names a part uniquely, is what a
 * run reports for each part (`backup_stand`) and contains no character that would need escaping,
 * and the prefix keeps the keys apart from any other argument. What is played back, into which
 * volume or database, comes from the signed manifest (restoreTeile), never from the job; the agent
 * reads repository, access and password from the installation's own backup.json, so the job
 * carries no field `backup` and no field `einrichtung`. Pure: the Zentrale checks a job with it
 * when it makes one, the agent again after key and signature, and then that the installation's
 * units were rendered from the job's manifest (their labels).
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name it */
export const WIEDERHERSTELLEN_AKTION = "installation_wiederherstellen";

/**
 * Playing every part back may take as long as backing it up; around it stopping the units, starting
 * them, their health (PRUEF_RESTORE_HEALTH_S) and, after a failure, starting them again
 */
export const WIEDERHERSTELLEN_ZEITLIMIT_S = BACKUP_ZEITLIMIT_S + 1800;

const PRAEFIX = "snapshot:";

/** The argument that names the snapshot of a part, by its tag */
export const snapshotArgument = (tag: string): string => `${PRAEFIX}${tag}`;

/** A full snapshot ID as restic prints it: never a prefix, which restic would resolve itself */
const SNAPSHOT = /^[0-9a-f]{64}$/;

export type WiederherstellenAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, unknown>>;
  einrichtung?: unknown;
  backup?: unknown;
};

export type WiederherstellenAuftrag = {
  art: "wiederherstellen";
  name: string;
  /** The installation's network, in which restic runs */
  netz: { name: string; unit: string };
  /** All parts of the manifest's `backup`, a command's among them (named in the result) */
  teile: RestoreTeil[];
  /** The snapshot of each part that is played back, by its tag */
  snapshots: Record<string, string>;
};

export type WiederherstellenGeprueft =
  | { ok: true; auftrag: WiederherstellenAuftrag }
  | { ok: false; grund: string };

const nein = (grund: string): WiederherstellenGeprueft => ({ ok: false, grund });

/** The tags of the parts that are played back (`volume`, `pg_dump`); a command's export is not */
export const zurueckspielbar = (teile: readonly RestoreTeil[]): string[] =>
  teile.flatMap((t) => (t.art === "befehl" ? [] : [t.tag]));

/**
 * The snapshot of each part from the arguments, or why they are not one per part; with `teilweise`
 * (an update's rollback, einrichtung/update.ts) some parts may lack one, but not all
 */
export const snapshotsLesen = (
  argumente: Readonly<Record<string, unknown>>,
  teile: readonly RestoreTeil[],
  teilweise = false,
): { ok: true; snapshots: Record<string, string> } | { ok: false; grund: string } => {
  const tags = zurueckspielbar(teile);
  const snapshots: Record<string, string> = {};
  for (const [schluessel, wert] of Object.entries(argumente)) {
    const tag = schluessel.startsWith(PRAEFIX) ? schluessel.slice(PRAEFIX.length) : undefined;
    if (tag === undefined || !tags.includes(tag))
      return {
        ok: false,
        grund: teile.some((t) => t.tag === tag)
          ? `${schluessel}: a command's export is not played back`
          : `unknown argument ${schluessel}`,
      };
    if (typeof wert !== "string" || !SNAPSHOT.test(wert))
      return { ok: false, grund: `${schluessel}: a snapshot ID of 64 hex characters` };
    snapshots[tag] = wert;
  }
  const fehlt = tags.filter((t) => snapshots[t] === undefined);
  if (fehlt.length > 0 && (!teilweise || fehlt.length === tags.length))
    return { ok: false, grund: `no snapshot for ${fehlt.map(snapshotArgument).join(", ")}` };
  return { ok: true, snapshots };
};

export const wiederherstellenAuftragPruefen = (
  m: Manifest,
  a: WiederherstellenAnfrage,
): WiederherstellenGeprueft => {
  if (a.aktion !== WIEDERHERSTELLEN_AKTION) return nein(`${a.aktion} is not a restore`);
  const name = a.installationId;
  if (name === null || !INSTALLATIONS_NAME.test(name))
    return nein("a restore belongs to a named installation");
  if (a.einrichtung !== undefined) return nein("a restore takes no installation data");
  if (a.backup !== undefined) return nein("a restore carries no backup data");
  const r = restoreTeile(m, name);
  if (!r.ok) return r;
  if (zurueckspielbar(r.teile).length === 0)
    return nein("the manifest names no part that is played back (volume, pg_dump)");
  const s = snapshotsLesen(a.argumente, r.teile);
  if (!s.ok) return s;
  return {
    ok: true,
    auftrag: {
      art: "wiederherstellen",
      name,
      netz: r.netz,
      teile: r.teile,
      snapshots: s.snapshots,
    },
  };
};

/**
 * The arguments of a restore from the parts of a chosen run, as the agent reported them (tag and
 * snapshot): one per part that is played back; a command's part is left out
 */
export const wiederherstellenArgumente = (
  m: Manifest,
  name: string,
  lauf: readonly { tag: string; snapshot: string | null }[],
): { ok: true; argumente: Record<string, string> } | { ok: false; grund: string } => {
  const r = restoreTeile(m, name);
  return r.ok ? snapshotArgumente(r.teile, lauf) : r;
};

/** One argument per part of `teile` that is played back, with its snapshot from the run */
export const snapshotArgumente = (
  teile: readonly RestoreTeil[],
  lauf: readonly { tag: string; snapshot: string | null }[],
): { ok: true; argumente: Record<string, string> } | { ok: false; grund: string } => {
  const argumente: Record<string, string> = {};
  for (const tag of zurueckspielbar(teile)) {
    const snapshot = lauf.find((t) => t.tag === tag)?.snapshot;
    if (typeof snapshot !== "string" || !SNAPSHOT.test(snapshot))
      return { ok: false, grund: `the run has no snapshot of ${tag}` };
    argumente[snapshotArgument(tag)] = snapshot;
  }
  return { ok: true, argumente };
};

/** What a restore that succeeded reports in `daten`: the shape of a Prüf-Restore's */
export type WiederherstellenDaten = PruefRestoreDaten;

/** The parts (at most 50) and the duration of the agent's `daten`; whatever else is dropped */
export const wiederherstellenDatenLesen = (daten: unknown): WiederherstellenDaten =>
  pruefRestoreDatenLesen(daten);

import {
  EINRICHTUNG_AKTIONEN,
  EINRICHTUNG_ZEITLIMIT_S,
  type Einrichtung,
  einrichtungAuftragPruefen,
} from "../einrichtung/auftraege.ts";
import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import type { Quadlets } from "../quadlet/typen.ts";
import type { Manifest } from "../schema.ts";
import { BACKUP_ZEITLIMIT_S, type BackupTeil, backupTeile } from "./auftraege.ts";

/*
 * The test restore (BAULISTE.md Z-602; docs/plan.md, "Prüf-Restore (Z-602)", "Prüf-Restore auf dem
 * Server (Z-602)"): built into the Steuerzentrale like the backup jobs, with a fixed shape. The job
 * names the original installation (`installationId`), whose backup the agent reads with the access
 * of its own `backup.json`, and carries the copy's name in the argument `kopie`
 * (`restore-<6 characters a-z, 0-9>`) and the copy's data in the field `einrichtung`: the
 * installation's settings with ports of its own. Units, secrets and files of the copy are rendered
 * from the signed manifest as for a setup, never taken from the job; the parts to restore are the
 * manifest's `backup`. No field `backup`: no server is sent an access here. Pure: the Zentrale
 * checks a job with it when it makes one, the agent again after key and signature.
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name it */
export const PRUEF_RESTORE_AKTION = "installation_pruef_restore";

/** The copy's name, and its Linux user `sz-<kopie>` */
export const PRUEF_RESTORE_KOPIE = /^restore-[a-z0-9]{6}$/;

/** Setting up the copy, restoring every part (as long as a backup may take) and its health */
export const PRUEF_RESTORE_ZEITLIMIT_S = EINRICHTUNG_ZEITLIMIT_S + BACKUP_ZEITLIMIT_S;

export type PruefRestoreAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, unknown>>;
  einrichtung?: Einrichtung | undefined;
  backup?: unknown;
};

export type PruefRestoreAuftrag = {
  art: "pruef_restore";
  /** The original installation, whose backup is restored */
  original: string;
  /** The copy, set up beside it and removed afterwards */
  kopie: string;
  quadlets: Quadlets;
  /** The systemd services of the copy's containers, in order */
  units: string[];
  /** The parts of the manifest's `backup`, named as the copy's units name them */
  teile: BackupTeil[];
};

export type PruefRestoreGeprueft =
  | { ok: true; auftrag: PruefRestoreAuftrag }
  | { ok: false; grund: string };

const nein = (grund: string): PruefRestoreGeprueft => ({ ok: false, grund });

export const pruefRestoreAuftragPruefen = (
  m: Manifest,
  a: PruefRestoreAnfrage,
): PruefRestoreGeprueft => {
  if (a.aktion !== PRUEF_RESTORE_AKTION) return nein(`${a.aktion} is not a test restore`);
  const original = a.installationId;
  if (original === null || !INSTALLATIONS_NAME.test(original))
    return nein("a test restore belongs to a named installation");
  const { kopie, ...fremd } = a.argumente;
  if (Object.keys(fremd).length > 0)
    return nein(`unknown argument ${Object.keys(fremd).join(", ")}`);
  if (typeof kopie !== "string" || !PRUEF_RESTORE_KOPIE.test(kopie))
    return nein("kopie: restore-<6 characters a-z, 0-9>");
  if (kopie === original) return nein("the copy must not be the installation itself");
  if (a.backup !== undefined) return nein("a test restore carries no backup data");
  if (a.einrichtung === undefined)
    return nein("a test restore needs the copy's data (einrichtung)");
  const teile = backupTeile(m, kopie);
  if (!teile.ok) return teile;
  const r = einrichtungAuftragPruefen(m, {
    aktion: EINRICHTUNG_AKTIONEN.einrichten,
    installationId: kopie,
    argumente: {},
    einrichtung: a.einrichtung,
  });
  if (!r.ok) return r;
  if (r.auftrag.art !== "einrichten") return nein("the copy did not render");
  const { quadlets, units } = r.auftrag;
  return {
    ok: true,
    auftrag: { art: "pruef_restore", original, kopie, quadlets, units, teile: teile.teile },
  };
};

/** A part as the agent reports it restored: its tag, the snapshot it read, or why not */
export type PruefRestoreTeil = {
  tag: string;
  snapshot: string | null;
  zurueckgespielt: boolean;
  grund: string | null;
};

/** What a successful test restore reports in `daten`, read without trusting its shape */
export type PruefRestoreDaten = { teile: PruefRestoreTeil[]; dauerMs: number | null };

const kurz = (x: unknown, max: number): string | null =>
  typeof x === "string" && x.length > 0 ? x.slice(0, max) : null;

const teilLesen = (x: unknown): PruefRestoreTeil | undefined => {
  if (typeof x !== "object" || x === null) return undefined;
  const t = x as Record<string, unknown>;
  const tag = kurz(t.tag, 200);
  if (tag === null) return undefined;
  return {
    tag,
    snapshot: kurz(t.snapshot, 64),
    zurueckgespielt: t.zurueckgespielt === true,
    grund: kurz(t.grund, 500),
  };
};

/** The parts (at most 50) and the duration of the agent's `daten`; whatever else is dropped */
export const pruefRestoreDatenLesen = (daten: unknown): PruefRestoreDaten => {
  const d = typeof daten === "object" && daten !== null ? (daten as Record<string, unknown>) : {};
  const teile = Array.isArray(d.teile)
    ? d.teile.slice(0, 50).flatMap((t) => teilLesen(t) ?? [])
    : [];
  const dauer = d.dauerMs;
  const dauerMs =
    typeof dauer === "number" && Number.isSafeInteger(dauer) && dauer >= 0 ? dauer : null;
  return { teile, dauerMs };
};

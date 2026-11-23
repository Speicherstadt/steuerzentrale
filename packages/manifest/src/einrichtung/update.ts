import {
  WIEDERHERSTELLEN_AKTION,
  WIEDERHERSTELLEN_ZEITLIMIT_S,
  wiederherstellenArgumente,
  wiederherstellenAuftragPruefen,
  zurueckspielbar,
} from "../backup/wiederherstellen.ts";
import { type RestoreTeil, restoreTeile } from "../backup/zurueckspielen.ts";
import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import type { Quadlets } from "../quadlet/typen.ts";
import type { Manifest } from "../schema.ts";
import {
  EINRICHTUNG_AKTIONEN,
  EINRICHTUNG_ZEITLIMIT_S,
  type Einrichtung,
  einrichtungAuftragPruefen,
} from "./auftraege.ts";

/*
 * Updating an installation to a new version (BAULISTE.md Z-503; docs/plan.md, "Update in der
 * Zentrale (Z-503)", "Update auf dem Server (Z-503)"): built into the Steuerzentrale like the setup
 * and restore jobs, with a fixed shape. The job carries the signed manifest of the new version and
 * the installation's data (`einrichtung`), from which the new units are rendered exactly as when
 * reconfiguring (einrichtungAuftragPruefen), so a new version that lacks a required value is refused
 * here. It names, as `snapshot:<tag>`, the snapshot of each played-back part of the backup the
 * Zentrale made just before (checked as a restore's, wiederherstellenAuftragPruefen): if the new
 * version turns red, the agent rolls back to the old units and plays these snapshots back. Without
 * such a backup an update could not be rolled back, so a manifest without a played-back part is
 * refused. The agent reads the repository and its password from the installation's own backup.json,
 * so the job carries no field `backup`. Pure: the Zentrale checks a job with it when it makes one,
 * the agent again after key and signature, and then that the installation's units were rendered
 * from the previous manifest (their labels).
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name it */
export const UPDATE_AKTION = "installation_update";

/** How long the new version's health may take to turn green before the update is rolled back */
export const UPDATE_HEALTH_S = 300;

/**
 * The backup before runs as its own job, so it is not counted. Pulling the new images, restarting
 * and `schritte.nach_update` take what setting up takes, then the health check; a rollback stops
 * the units, plays the backup back and starts the old units with their health, which is a restore.
 */
export const UPDATE_ZEITLIMIT_S =
  EINRICHTUNG_ZEITLIMIT_S + UPDATE_HEALTH_S + WIEDERHERSTELLEN_ZEITLIMIT_S;

export type UpdateAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, unknown>>;
  einrichtung?: Einrichtung | undefined;
  backup?: unknown;
};

export type UpdateAuftrag = {
  art: "update";
  name: string;
  /** The units, secrets and files of the new version, rendered from the new manifest */
  quadlets: Quadlets;
  /** The systemd services Quadlet makes of the new version's containers, in order */
  units: string[];
  /** The names of the commands of the new manifest's `schritte.nach_update` */
  schritte: string[];
  /** The installation's network, in which restic runs during a rollback */
  netz: { name: string; unit: string };
  /** All parts of the manifest's `backup`, a command's among them */
  teile: RestoreTeil[];
  /** The snapshot of each played-back part of the backup before, by its tag */
  snapshots: Record<string, string>;
};

export type UpdateGeprueft = { ok: true; auftrag: UpdateAuftrag } | { ok: false; grund: string };

const nein = (grund: string): UpdateGeprueft => ({ ok: false, grund });

const zurueckzunehmen = (m: Manifest, name: string): boolean => {
  const r = restoreTeile(m, name);
  return r.ok && zurueckspielbar(r.teile).length > 0;
};

export const updateAuftragPruefen = (m: Manifest, a: UpdateAnfrage): UpdateGeprueft => {
  if (a.aktion !== UPDATE_AKTION) return nein(`${a.aktion} is not an update`);
  const name = a.installationId;
  if (name === null || !INSTALLATIONS_NAME.test(name))
    return nein("an update belongs to a named installation");
  if (a.backup !== undefined) return nein("an update carries no backup data");
  if (a.einrichtung === undefined)
    return nein("an update needs the installation data (einrichtung)");
  if (!zurueckzunehmen(m, name)) return nein("an update needs a backup to roll back to");
  const neu = einrichtungAuftragPruefen(m, {
    aktion: EINRICHTUNG_AKTIONEN.konfigurieren,
    installationId: name,
    argumente: {},
    einrichtung: a.einrichtung,
  });
  if (!neu.ok) return neu;
  if (neu.auftrag.art !== "konfigurieren") return nein("the new version could not be rendered");
  const zurueck = wiederherstellenAuftragPruefen(m, {
    aktion: WIEDERHERSTELLEN_AKTION,
    installationId: name,
    argumente: a.argumente,
  });
  if (!zurueck.ok) return zurueck;
  return {
    ok: true,
    auftrag: {
      art: "update",
      name,
      quadlets: neu.auftrag.quadlets,
      units: neu.auftrag.units,
      schritte: m.schritte.nach_update,
      netz: zurueck.auftrag.netz,
      teile: zurueck.auftrag.teile,
      snapshots: zurueck.auftrag.snapshots,
    },
  };
};

/**
 * The arguments of an update from the parts of the backup made just before, as the agent reported
 * them (tag and snapshot): the same as a restore's from that run
 */
export const updateArgumente = (
  m: Manifest,
  name: string,
  lauf: readonly { tag: string; snapshot: string | null }[],
): { ok: true; argumente: Record<string, string> } | { ok: false; grund: string } =>
  wiederherstellenArgumente(m, name, lauf);

/** What an update reports in `daten`: whether it holds, or was rolled back and why */
export type UpdateDaten = (
  | { ergebnis: "aktualisiert" }
  | { ergebnis: "zurueckgenommen"; grund: string }
  | { ergebnis: "ruecknahme_unvollstaendig"; grund: string }
) & { dauerMs: number | null };

const GRUND_MAX = 500;

const grundLesen = (x: unknown): string =>
  typeof x === "string" && x.length > 0 ? x.slice(0, GRUND_MAX) : "no reason reported";

/**
 * The result, its reason (at most 500 characters) and the duration of the agent's `daten`;
 * whatever else is dropped. Null when `ergebnis` is none of the three: the Zentrale then knows
 * nothing of how the update ended.
 */
export const updateDatenLesen = (daten: unknown): UpdateDaten | null => {
  const d = typeof daten === "object" && daten !== null ? (daten as Record<string, unknown>) : {};
  const dauer = d.dauerMs;
  const dauerMs =
    typeof dauer === "number" && Number.isSafeInteger(dauer) && dauer >= 0 ? dauer : null;
  switch (d.ergebnis) {
    case "aktualisiert":
      return { ergebnis: "aktualisiert", dauerMs };
    case "zurueckgenommen":
    case "ruecknahme_unvollstaendig":
      return { ergebnis: d.ergebnis, grund: grundLesen(d.grund), dauerMs };
    default:
      return null;
  }
};

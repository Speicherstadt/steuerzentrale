import type { InstallationsAngebot } from "./apps.ts";
import type { BackupZeile } from "./backups.ts";

/*
 * Two tiles of the overview as data (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): the update
 * wave that runs (GET /api/v1/updates: the installations a plan holds or whose update runs, and
 * those already on its version), else how many could be updated; and last night's backups (GET
 * /api/v1/backups), each app by its run since yesterday evening. Pure.
 */

export type Welle = { app: string; version: string; fertig: number; gesamt: number };

/** The version a plan or a running update takes an installation to */
const ziel = (a: InstallationsAngebot) =>
  a.plan?.version ?? (a.update.laeuft ? a.update.letzter?.nachVersion : undefined);

/** The wave that runs (one with an update under way first), and the updates beside it */
export const laufendeWelle = (
  angebote: InstallationsAngebot[],
): { welle: Welle | null; moeglich: number } => {
  const unterwegs = angebote.filter((a) => ziel(a) !== undefined);
  const erste = unterwegs.find((a) => a.update.laeuft) ?? unterwegs[0];
  const version = erste && ziel(erste);
  if (!erste || !version)
    return { welle: null, moeglich: angebote.filter((a) => a.angeboten.length > 0).length };
  const dabei = unterwegs.filter((a) => a.app === erste.app && ziel(a) === version);
  const fertig = angebote.filter((a) => a.app === erste.app && a.version === version).length;
  return {
    welle: { app: erste.app, version, fertig, gesamt: fertig + dabei.length },
    moeglich: angebote.filter((a) => a.angeboten.length > 0 && !dabei.includes(a)).length,
  };
};

export type NachtTon = "ok" | "warn" | "danger" | "leer";

type NachtZeile = Pick<BackupZeile, "app" | "kundeName" | "teile"> & {
  letzter: { zeitpunkt: number; ok: boolean } | null;
  pruefRestore: { letzter: { ok: boolean } | null };
};

export type Nacht = {
  teile: { app: string; kundeName: string; ton: NachtTon }[];
  ok: number;
  gesamt: number;
  gescheitert: { app: string; kundeName: string }[];
  pruefGescheitert: number;
};

/** Succeeded since `seit`; failed; ran before only; never ran */
const tonVon = (z: NachtZeile, seit: number): NachtTon => {
  if (!z.letzter) return "leer";
  if (!z.letzter.ok) return "danger";
  return z.letzter.zeitpunkt >= seit ? "ok" : "warn";
};

/** The apps with parts to back up, each by its newest run; what failed by name */
export const backupsDerNacht = (zeilen: NachtZeile[], seit: number): Nacht => {
  const mit = zeilen.filter((z) => z.teile.length > 0);
  const teile = mit.map((z) => ({ app: z.app, kundeName: z.kundeName, ton: tonVon(z, seit) }));
  return {
    teile,
    ok: teile.filter((t) => t.ton === "ok").length,
    gesamt: teile.length,
    gescheitert: teile
      .filter((t) => t.ton === "danger")
      .map((t) => ({ app: t.app, kundeName: t.kundeName })),
    pruefGescheitert: mit.filter((z) => z.pruefRestore.letzter?.ok === false).length,
  };
};

import {
  ABWICKLUNG_AKTIONEN,
  BACKUP_AKTIONEN,
  manifestPruefen,
  nurLesenBefehl,
} from "@steuerzentrale/manifest";
import type { Kontext } from "../audit/index.ts";
import { auftragVorbereiten, type NeuerAuftrag, type VorabAuftrag } from "../auftraege/anlegen.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import type { AuftragDeps } from "../auftraege/zustellen.ts";
import { backupEingerichtet } from "../backups/auftraege.ts";
import { backupZielLesen } from "../backups/ziel.ts";
import type { Installation } from "../installationen/lesen.ts";

/*
 * The chains of jobs after a contract ended (BAULISTE.md Z-604; docs/plan.md, "Kündigung und
 * Löschung"), prepared unwritten, each job waiting for the one before (Z-305), so one that fails
 * cancels the rest:
 * - at the end: "nur lesen" if the manifest offers it, then the last backup and the archive for
 *   the customer, if the installation's backups are set up;
 * - at the deletion: the last backup, if set up, then `installation_loeschen`, which the agent
 *   refuses without a successful backup in the last two hours.
 */

export type Kette =
  | { ok: true; zeilen: Auftrag[]; letzter: string | null }
  | { ok: false; detail: string };

const basis = (i: Installation) => ({
  serverId: i.serverId,
  installationId: i.installationId,
  manifest: i.manifest,
  signatur: i.signatur,
});

/** Each job prepared after the one before, in one change */
const verketten = (
  deps: AuftragDeps,
  kontext: Kontext,
  i: Installation,
  schritte: { aktion: string; argumente: NeuerAuftrag["argumente"] }[],
): Kette => {
  const zeilen: Auftrag[] = [];
  for (const s of schritte) {
    const vorher = zeilen.at(-1);
    const v = auftragVorbereiten(
      deps,
      kontext,
      { ...basis(i), ...s, ...(vorher ? { wartetAuf: [vorher.auftragId] } : {}) },
      zeilen as VorabAuftrag[],
    );
    if (!v.ok) return { ok: false, detail: `${s.aktion}: ${v.detail ?? v.grund}` };
    zeilen.push(v.zeile);
  }
  return { ok: true, zeilen, letzter: zeilen.at(-1)?.auftragId ?? null };
};

const gesichert = (deps: AuftragDeps, i: Installation) =>
  backupEingerichtet(deps.db, i.betreiberId, i.installationId);

/**
 * At the end: "nur lesen" (`mitNurLesen`, only the first time), the backup and the archive;
 * `letzter` is the archive's job, null when there is nothing to archive
 */
export const archivKette = (
  deps: AuftragDeps,
  kontext: Kontext,
  i: Installation,
  mitNurLesen: boolean,
): Kette => {
  const m = manifestPruefen(i.manifest);
  if (!m.ok) return { ok: false, detail: "the installation's manifest does not check" };
  const nurLesen = mitNurLesen ? nurLesenBefehl(m.manifest) : undefined;
  const region = backupZielLesen(deps.db, i.betreiberId).region;
  const sichern = gesichert(deps, i) && region !== null;
  const kette = verketten(deps, kontext, i, [
    ...(nurLesen ? [{ aktion: nurLesen, argumente: {} }] : []),
    ...(sichern
      ? [
          { aktion: BACKUP_AKTIONEN.jetzt, argumente: {} },
          { aktion: ABWICKLUNG_AKTIONEN.archiv, argumente: { region: region as string } },
        ]
      : []),
  ]);
  return kette.ok && !sichern ? { ...kette, letzter: null } : kette;
};

/** At the deletion: the last backup if set up, then taking the installation down */
export const loeschKette = (deps: AuftragDeps, kontext: Kontext, i: Installation): Kette =>
  verketten(deps, kontext, i, [
    ...(gesichert(deps, i) ? [{ aktion: BACKUP_AKTIONEN.jetzt, argumente: {} }] : []),
    { aktion: ABWICKLUNG_AKTIONEN.loeschen, argumente: {} },
  ]);

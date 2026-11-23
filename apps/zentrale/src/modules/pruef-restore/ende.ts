import { PRUEF_RESTORE_AKTION, pruefRestoreDatenLesen } from "@steuerzentrale/manifest";
import {
  type AuftragZustand,
  ENDZUSTAENDE,
  type NachrichtVomAgenten,
} from "@steuerzentrale/protokoll";
import type { Db } from "../../db/oeffnen.ts";
import type { Schreiber } from "../audit/index.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import { kopieVon, portsFreigeben } from "./kopie.ts";

/*
 * The end of a test restore (BAULISTE.md Z-602; docs/plan.md, "Prüf-Restore (Z-602)"), within the
 * transaction that records the job's end (modules/auftraege/melden.ts): the copy's ports are free
 * again, the result is a row of `pruef_restores` (succeeded or why not, the snapshot of each part,
 * the agent's duration) and a failed one also the event `pruef_restore_gescheitert` (severity
 * `fehler`). A job cancelled without a result counts as failed.
 */

export const PRUEF_RESTORE_GESCHEITERT_ART = "pruef_restore_gescheitert";

type Ergebnis = Extract<NachrichtVomAgenten, { typ: "ergebnis" }>["ergebnis"];

export const pruefRestoreAbschliessen = (
  w: Schreiber,
  db: Db,
  a: Pick<
    Auftrag,
    "betreiberId" | "auftragId" | "serverId" | "installationId" | "aktion" | "argumente"
  >,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
  jetzt: number,
): void => {
  if (a.aktion !== PRUEF_RESTORE_AKTION || !ENDZUSTAENDE.has(zustand) || a.installationId === null)
    return;
  const kopie = kopieVon(a) ?? "";
  const { betreiberId, installationId } = a;
  portsFreigeben(w, db, { betreiberId, installationId, kopie });
  const ok = zustand === "erfolgreich";
  const daten = pruefRestoreDatenLesen(ergebnis?.ok ? ergebnis.daten : undefined);
  const grund = ok ? null : ergebnis && !ergebnis.ok ? ergebnis.fehler : `Auftrag ${zustand}`;
  w.einfuegen("pruefRestores", {
    betreiberId,
    auftragId: a.auftragId,
    installationId,
    serverId: a.serverId,
    kopie,
    zeitpunkt: jetzt,
    ok,
    grund,
    teile: JSON.stringify(daten.teile),
    dauerMs: daten.dauerMs,
  });
  if (!ok)
    w.einfuegen("ereignisse", {
      betreiberId,
      ereignisId: `pruef-restore-${a.auftragId}`,
      zeitpunkt: jetzt,
      art: PRUEF_RESTORE_GESCHEITERT_ART,
      schwere: "fehler",
      ziel: `installation:${installationId}`,
      text: `Prüf-Restore von ${installationId} gescheitert: ${grund}`,
    });
};

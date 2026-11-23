import {
  manifestPruefen,
  type UpdateDaten,
  updateArgumente,
  updateDatenLesen,
} from "@steuerzentrale/manifest";
import {
  type AuftragZustand,
  ENDZUSTAENDE,
  type NachrichtVomAgenten,
} from "@steuerzentrale/protokoll";
import type { Db } from "../../db/oeffnen.ts";
import type { UPDATE_ERGEBNISSE } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import type { Schreiber } from "../audit/index.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { konfigurationAbschliessen } from "../installationen/konfiguration.ts";
import { type UpdateZeile, updateZu } from "./lesen.ts";

/*
 * The end of an update (BAULISTE.md Z-503; docs/plan.md, "Update in der Zentrale (Z-503)", "Update
 * auf dem Server (Z-503)"), within the transaction that records a job's end
 * (modules/auftraege/melden.ts):
 * - the backup before succeeded: the update, now ready, gets the snapshot of each played-back part
 *   of that run as `snapshot:<tag>` before it goes to the agent; a run without one cancels it;
 * - the backup failed or was cancelled: the update is cancelled with it (abhaengigkeiten.ts) and
 *   nothing changed on the server;
 * - the update ended: the agent reports `aktualisiert`, `zurueckgenommen` or
 *   `ruecknahme_unvollstaendig` in `daten` of a successful result (updateDatenLesen); a failed
 *   result, a cancelled job or `daten` of none of the three is a failure with no known outcome.
 *   Only `aktualisiert` raises the installation to the new version (manifest, signature, values);
 *   every other end keeps the old one and halts the waves of the version (lesen.ts, `stoerungAm`).
 * Each end makes an event of the installation; the change of the row stands in the audit log.
 */

export const UPDATE_ARTEN = {
  aktualisiert: "update_gelungen",
  zurueckgenommen: "update_zurueckgenommen",
  ruecknahme_unvollstaendig: "update_ruecknahme_unvollstaendig",
  gescheitert: "update_gescheitert",
  abgebrochen: "update_abgebrochen",
} as const satisfies Record<(typeof UPDATE_ERGEBNISSE)[number], string>;

type Ergebnis = Extract<NachrichtVomAgenten, { typ: "ergebnis" }>["ergebnis"];
type UpdateErgebnis = (typeof UPDATE_ERGEBNISSE)[number];
type Ende = { ergebnis: UpdateErgebnis; fehler: string | null; dauerMs: number | null };
type Deps = { db: Db; schluessel: Schluesselbund };

const grundVon = (zustand: AuftragZustand, ergebnis: Ergebnis | undefined): string =>
  ergebnis && !ergebnis.ok ? ergebnis.fehler : `Auftrag ${zustand}`;

const SCHWERE: Record<UpdateErgebnis, string> = {
  aktualisiert: "info",
  zurueckgenommen: "fehler",
  ruecknahme_unvollstaendig: "fehler",
  gescheitert: "fehler",
  abgebrochen: "warn",
};

const ereignisText = (z: UpdateZeile, ende: Ende): string => {
  const was = `Update von ${z.installationId} auf ${z.app} ${z.nachVersion}`;
  const grund = ende.fehler ?? "";
  switch (ende.ergebnis) {
    case "aktualisiert":
      return `${was} gelungen`;
    case "zurueckgenommen":
      return `${was} zurückgenommen, wieder ${z.vonVersion}: ${grund}`;
    case "ruecknahme_unvollstaendig":
      return `${was} gescheitert, Rücknahme unvollständig: ${grund}`;
    case "gescheitert":
      return `${was} gescheitert: ${grund}`;
    case "abgebrochen":
      return `${was} abgebrochen: ${grund}`;
  }
};

/** The installation on the new version: its manifest, signature and values (asked for the job) */
const versionHeben = (w: Schreiber, deps: Deps, z: UpdateZeile, jetzt: number): void => {
  const a = auftragLesen(deps.db, z.betreiberId, z.auftragId);
  if (!a) throw new Error(`update ${z.auftragId} without its job`);
  konfigurationAbschliessen(w, deps, a, true, jetzt);
  w.aendern(
    "installationen",
    { installationId: z.installationId },
    {
      version: a.version,
      manifest: a.manifest,
      manifestHash: a.manifestHash,
      signatur: a.signatur,
      geaendertAm: jetzt,
    },
  );
};

/** Writes the update's end, its event and, for `aktualisiert`, the installation's new version */
const beenden = (w: Schreiber, deps: Deps, z: UpdateZeile, ende: Ende, jetzt: number): void => {
  if (ende.ergebnis === "aktualisiert") versionHeben(w, deps, z, jetzt);
  else konfigurationAbschliessen(w, deps, z, false, jetzt);
  w.aendern(
    "updates",
    { auftragId: z.auftragId },
    { endeAm: jetzt, ergebnis: ende.ergebnis, fehler: ende.fehler, dauerMs: ende.dauerMs },
  );
  w.einfuegen("ereignisse", {
    betreiberId: z.betreiberId,
    ereignisId: `update-${z.auftragId}`,
    zeitpunkt: jetzt,
    art: UPDATE_ARTEN[ende.ergebnis],
    schwere: SCHWERE[ende.ergebnis],
    ziel: `installation:${z.installationId}`,
    text: ereignisText(z, ende),
  });
};

/** What the agent's `daten` say of the update's end; null when it knows none of the three */
const ausDaten = (d: UpdateDaten | null): Ende | null => {
  if (!d) return null;
  if (d.ergebnis === "aktualisiert")
    return { ergebnis: d.ergebnis, fehler: null, dauerMs: d.dauerMs };
  return { ergebnis: d.ergebnis, fehler: d.grund, dauerMs: d.dauerMs };
};

/** What the end of one of the update's jobs means for it, or undefined while it goes on */
const endeVon = (
  z: UpdateZeile,
  auftragId: string,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
): Ende | undefined => {
  if (z.backupAuftragId === auftragId) {
    if (zustand === "erfolgreich") return undefined;
    const fehler = `Backup vor dem Update gescheitert: ${grundVon(zustand, ergebnis)}`;
    return { ergebnis: "abgebrochen", fehler, dauerMs: null };
  }
  const gelesen = ergebnis?.ok ? ausDaten(updateDatenLesen(ergebnis.daten)) : null;
  if (zustand === "erfolgreich" && gelesen) return gelesen;
  const fehler =
    zustand === "erfolgreich" ? "Ergebnis des Agenten ohne Ausgang" : grundVon(zustand, ergebnis);
  return { ergebnis: "gescheitert", fehler, dauerMs: null };
};

export const updateFortschreiben = (
  w: Schreiber,
  deps: Deps,
  a: Pick<Auftrag, "betreiberId" | "auftragId">,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
  jetzt: number,
): void => {
  if (!ENDZUSTAENDE.has(zustand)) return;
  const z = updateZu(deps.db, a.betreiberId, a.auftragId);
  if (!z || z.endeAm !== null) return;
  const ende = endeVon(z, a.auftragId, zustand, ergebnis);
  if (ende) beenden(w, deps, z, ende, jetzt);
};

/** The parts of a backup run as the agent reported them in its result (backup/auftrag.ts) */
const laufTeile = (ergebnis: Ergebnis | undefined): { tag: string; snapshot: string | null }[] => {
  const daten = ergebnis?.ok ? (ergebnis.daten as { teile?: unknown }) : undefined;
  const teile = Array.isArray(daten?.teile) ? (daten.teile as unknown[]) : [];
  return teile.flatMap((t) => {
    const teil = t as { tag?: unknown; snapshot?: unknown };
    if (typeof teil.tag !== "string") return [];
    return [{ tag: teil.tag, snapshot: typeof teil.snapshot === "string" ? teil.snapshot : null }];
  });
};

/**
 * After the backup `a` succeeded, among the jobs that became ready: an update waiting for it gets
 * the run's snapshots as its arguments, or is cancelled with its reason when the run lacks one; it
 * never left the Zentrale. Returns the ready jobs as they are now, to be sent.
 */
export const updateSnapshotsSetzen = (
  w: Schreiber,
  deps: Deps,
  a: Pick<Auftrag, "betreiberId" | "auftragId">,
  ergebnis: Ergebnis | undefined,
  bereit: readonly Auftrag[],
  jetzt: number,
): Auftrag[] => {
  const z = updateZu(deps.db, a.betreiberId, a.auftragId);
  const update = z?.backupAuftragId === a.auftragId ? z : undefined;
  if (!update || update.endeAm !== null) return [...bereit];
  return bereit.flatMap((b) => {
    if (b.auftragId !== update.auftragId) return [b];
    const m = manifestPruefen(b.manifest);
    const argumente = m.ok
      ? updateArgumente(m.manifest, update.installationId, laufTeile(ergebnis))
      : { ok: false as const, grund: "manifest_ungueltig" };
    if (argumente.ok)
      return [
        w.aendern(
          "auftraege",
          { auftragId: b.auftragId },
          { argumente: JSON.stringify(argumente.argumente), geaendertAm: jetzt },
        ),
      ];
    const fehler = `Backup vor dem Update ohne Snapshot: ${argumente.grund}`;
    w.aendern(
      "auftraege",
      { auftragId: b.auftragId },
      {
        zustand: "abgebrochen",
        geaendertAm: jetzt,
        ergebnis: JSON.stringify({ ok: false, fehler }),
      },
    );
    beenden(w, deps, update, { ergebnis: "abgebrochen", fehler, dauerMs: null }, jetzt);
    return [];
  });
};

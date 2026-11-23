import { BackupStand, PROTOKOLL_VERSION, schreiben } from "@steuerzentrale/protokoll";
import { z } from "zod";
import type { Dateien } from "../dateien.ts";
import type { Gedaechtnis } from "../einrichtung/gedaechtnis.ts";
import { type NutzerLesen, nutzerName } from "../einrichtung/nutzer.ts";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";
import type { Lauf } from "./datei.ts";
import { laeufeLesen } from "./stand.ts";

/*
 * The agent reports the backup runs of its installations (BAULISTE.md Z-601; docs/plan.md, "Backup
 * auf dem Server"): while connected it reads the stand file of each installation it finished and
 * sends every run it has not reported as `backup_stand`, also runs made while the Zentrale was
 * away. What it sent it keeps in /var/lib/steuerzentrale/backup-gemeldet.json (run IDs per
 * installation, as many as the stand file still holds). A message in flight when a connection
 * breaks may be lost, so at the start of each connection the newest run of each installation goes
 * out once more; the Zentrale keeps a run once by its ID.
 */

export type BackupMelderDeps = {
  gedaechtnis: Gedaechtnis;
  nutzer: NutzerLesen;
  lesen: SpawnMitAusgabe;
  dateien: Dateien;
  /** The record of reported runs (pfade.ts, `backupGemeldet`) */
  pfad: string;
  log: (msg: string, mehr?: Record<string, unknown>) => void;
};

/** Sends a message over the current connection; false when there is none any more */
export type Senden = (text: string) => boolean;

const Gemeldet = z.object({ installationen: z.record(z.string(), z.array(z.string())) });
type Gemeldet = Record<string, string[]>;

const gemeldetLesen = async (deps: BackupMelderDeps): Promise<Gemeldet> => {
  const text = await deps.dateien.lesen(deps.pfad);
  if (text === undefined) return {};
  try {
    const g = Gemeldet.safeParse(JSON.parse(text));
    if (g.success) return g.data.installationen;
  } catch {
    // not JSON: as if nothing was reported; the Zentrale keeps a run once
  }
  deps.log("backup record unreadable, reporting again", { pfad: deps.pfad });
  return {};
};

const nachricht = (installationId: string, l: Lauf) =>
  schreiben(BackupStand, {
    typ: "backup_stand",
    protokoll: PROTOKOLL_VERSION,
    installationId,
    ...l,
  });

/** Sends the runs of one installation not yet reported; returns the IDs now reported */
const installationMelden = (
  name: string,
  laeufe: readonly Lauf[],
  bekannt: ReadonlySet<string>,
  erste: boolean,
  senden: Senden,
): string[] => {
  const neueste = laeufe.at(-1)?.lauf;
  const gemeldet: string[] = [];
  for (const l of laeufe) {
    const schon = bekannt.has(l.lauf) && !(erste && l.lauf === neueste);
    if (schon || senden(nachricht(name, l))) gemeldet.push(l.lauf);
  }
  return gemeldet;
};

/**
 * One round over the finished installations; `erste` at the start of a connection. Never throws:
 * what cannot be read now is read next round
 */
export const backupMelder =
  (deps: BackupMelderDeps) =>
  async (senden: Senden, erste: boolean): Promise<void> => {
    const g = await deps.gedaechtnis.lesen();
    if (!g.ok) return;
    const vorher = await gemeldetLesen(deps);
    const nachher: Gemeldet = {};
    for (const [name, eintrag] of g.stand) {
      if (eintrag.zustand !== "fertig") continue;
      const n = await deps.nutzer(nutzerName(name));
      const laeufe = n && (await laeufeLesen(deps, n, name));
      if (!laeufe) {
        // no stand (yet), or unreadable now: keep what was reported
        if (vorher[name]) nachher[name] = vorher[name];
        continue;
      }
      nachher[name] = installationMelden(name, laeufe, new Set(vorher[name]), erste, senden);
    }
    if (JSON.stringify(nachher) === JSON.stringify(vorher)) return;
    await deps.dateien
      .schreiben(deps.pfad, JSON.stringify({ installationen: nachher }), 0o600)
      .catch((fehler) => deps.log("backup record not written", { fehler: String(fehler) }));
  };

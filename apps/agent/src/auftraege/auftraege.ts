import { AGENT_BINARY } from "@steuerzentrale/manifest";
import {
  Bestaetigt,
  Ergebnis as ErgebnisNachricht,
  Fortschritt,
  LogAuszug,
  PROTOKOLL_VERSION,
  schreiben,
} from "@steuerzentrale/protokoll";
import { type AktionsDeps, aktionAusfuehren } from "../aktionen/auftrag.ts";
import type { ZeilenLesen } from "../aktionen/journal.ts";
import { backupAusfuehren } from "../backup/auftrag.ts";
import type { Dateien } from "../dateien.ts";
import { einrichtungAusfuehren, installationsNutzer } from "../einrichtung/auftrag.ts";
import { type Gedaechtnis, gedaechtnisOeffnen } from "../einrichtung/gedaechtnis.ts";
import type { HausDateien } from "../einrichtung/haus.ts";
import type { NutzerLesen } from "../einrichtung/nutzer.ts";
import { type PforteDeps, pforteAusfuehren } from "../pforte/ausfuehren.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";
import { ausfuehren, type Ergebnis, type Spawn } from "./ausfuehren.ts";
import {
  type AktionPlan,
  type AuftragNachricht,
  auftragPruefen,
  type BackupPlan,
  type EinrichtungPlan,
  type PfortePlan,
  type Plan,
  type Vertrauen,
} from "./pruefen.ts";
import { type Geladen, type Stand, standLaden, standSchreiber } from "./zustand.ts";

/*
 * The agent's side of jobs (BAULISTE.md Z-305): it acknowledges a job, checks it (pruefen.ts),
 * reports that it runs, runs it (ausfuehren.ts as the installation's user; a job of the Pforte
 * through its admin API, src/pforte; a setup job by src/einrichtung; a restart or log excerpt by
 * src/aktionen, whose lines go out as `log_auszug` before the result; a backup job by src/backup)
 * and reports the result.
 * Idempotent by the job's
 * id through its record (zustand.ts): a finished job sent again gets its stored result, a running
 * one only an acknowledgement. A job that was running when the agent stopped is reported failed
 * ("Agent neu gestartet") when the Zentrale sends it again after the restart; only a command the
 * manifest marks `idempotent` is run again instead (docs/plan.md, "Aufträge"), and a setup job,
 * which its record of installations tells apart (src/einrichtung/gedaechtnis.ts).
 */

/** What the setup jobs and the commands need of the installations (Z-402) */
export type InstallationenDeps = {
  /** The record of installations (pfade.ts, `installationen`) */
  pfad: string;
  /**
   * The record opened once and shared with the checks (src/zustand, Z-403), so both see each
   * write; opened from `pfad` without
   */
  gedaechtnis?: Gedaechtnis;
  haus: HausDateien;
  nutzer: NutzerLesen;
  /** Reads the old Podman secrets before reconfiguring (Z-404, einrichtung/secrets.ts) */
  lesen: SpawnMitAusgabe;
  /** Reads the journal for a log excerpt (Z-405, aktionen/journal.ts) */
  journal: ZeilenLesen;
  warten: (ms: number) => Promise<void>;
  /** The agent's binary the backup's service runs (Z-601); AGENT_BINARY without, other in tests */
  agent?: string;
};

export type AuftraegeDeps = {
  dateien: Dateien;
  /** The record's file (pfade.ts, `auftraege`) */
  pfad: string;
  vertrauen: Vertrauen;
  spawn: Spawn;
  /** The Pforte's admin API and base configuration, for its jobs (Z-401) */
  pforte: PforteDeps;
  installationen: InstallationenDeps;
  planen: Planer;
  jetzt: () => number;
  log: (msg: string, mehr?: Record<string, unknown>) => void;
};

export type Auftraege = {
  /** Handles a job; `senden` reaches the Zentrale over the current connection, if any */
  empfangen: (n: AuftragNachricht, senden: (text: string) => void) => Promise<void>;
};

export const NEU_GESTARTET = "Agent neu gestartet";

/** The longest error text a result carries (packages/protokoll, `ergebnis`) */
const MAX_FEHLER = 2000;

const bestaetigt = (auftragId: string) =>
  schreiben(Bestaetigt, { typ: "bestaetigt", protokoll: PROTOKOLL_VERSION, auftragId });

/**
 * Runs what it is given one after another: the jobs of the Pforte read its routes, check them and
 * then write (pforte/admin.ts), and a second job in between would pass the check on stale routes
 */
const reihe = () => {
  let letzte: Promise<unknown> = Promise.resolve();
  return <T>(f: () => Promise<T>): Promise<T> => {
    const naechste = letzte.then(f, f);
    letzte = naechste.catch(() => {});
    return naechste;
  };
};

type JederPlan = Plan | PfortePlan | EinrichtungPlan | AktionPlan | BackupPlan;

/** Runs a checked plan by its kind: a command as the installation's user, or a built-in job */
const ausfuehrer = (deps: AuftraegeDeps) => {
  const pforteReihe = reihe();
  // one setup after the other: two would write the Pforte's unit or one installation at once; the
  // actions of an installation (Z-405) wait in the same line, so none meets a setup half done
  const einrichtungReihe = reihe();
  const system: AktionsDeps = {
    ...deps.installationen,
    spawn: deps.spawn,
    planen: deps.planen,
    gedaechtnis:
      deps.installationen.gedaechtnis ??
      gedaechtnisOeffnen(deps.dateien, deps.installationen.pfad, deps.jetzt),
  };
  const backup = { ...system, agent: deps.installationen.agent ?? AGENT_BINARY, jetzt: deps.jetzt };
  return async (plan: JederPlan, auszugSenden: (zeilen: string[]) => void): Promise<Ergebnis> => {
    if (plan.art === "pforte") return pforteReihe(() => pforteAusfuehren(deps, plan));
    if (plan.art === "einrichtung")
      return einrichtungReihe(() => einrichtungAusfuehren(system, plan));
    if (plan.art === "aktion")
      return einrichtungReihe(() => aktionAusfuehren(system, plan, auszugSenden));
    // setting up a backup writes into the home like a setup; a run may take hours and waits for none
    if (plan.art === "backup")
      return plan.auftrag.art === "einrichten"
        ? einrichtungReihe(() => backupAusfuehren(backup, plan))
        : backupAusfuehren(backup, plan);
    const als = await installationsNutzer(system, plan.installationId);
    if (!als.ok) return { ok: false, fehler: `abgelehnt: ${als.grund}` };
    return ausfuehren(deps, plan, als.nutzer);
  };
};

export const auftraegeAnnehmen = (deps: AuftraegeDeps): Auftraege => {
  const schreibe = standSchreiber(deps.dateien, deps.pfad, deps.jetzt);
  let geladen: Promise<Geladen> | undefined;
  const laufend = new Set<string>();
  const planAusfuehren = ausfuehrer(deps);

  const ergebnisSenden = (auftragId: string, ergebnis: Ergebnis, senden: (t: string) => void) =>
    senden(
      schreiben(ErgebnisNachricht, {
        typ: "ergebnis",
        protokoll: PROTOKOLL_VERSION,
        auftragId,
        zeit: deps.jetzt(),
        ergebnis,
      }),
    );

  /** Keeps the result, then sends it: a result never leaves before it is recorded */
  const abschliessen = async (
    stand: Stand,
    auftragId: string,
    ergebnis: Ergebnis,
    senden: (t: string) => void,
  ) => {
    const gekuerzt: Ergebnis = ergebnis.ok
      ? ergebnis
      : { ok: false, fehler: ergebnis.fehler.slice(0, MAX_FEHLER) };
    stand.set(auftragId, { zustand: "fertig", am: deps.jetzt(), ergebnis: gekuerzt });
    await schreibe(stand);
    deps.log("job finished", { auftragId, ok: ergebnis.ok });
    ergebnisSenden(auftragId, gekuerzt, senden);
  };

  const starten = async (
    stand: Stand,
    n: AuftragNachricht,
    plan: JederPlan,
    senden: (t: string) => void,
  ) => {
    laufend.add(n.auftragId);
    stand.set(n.auftragId, { zustand: "laeuft", am: deps.jetzt() });
    try {
      await schreibe(stand);
      senden(
        schreiben(Fortschritt, {
          typ: "fortschritt",
          protokoll: PROTOKOLL_VERSION,
          auftragId: n.auftragId,
          schritt: plan.aktion,
          zeit: deps.jetzt(),
        }),
      );
      // the lines of a log excerpt go out before its result (docs/plan.md, "Log-Auszug")
      const ergebnis = await planAusfuehren(plan, (zeilen) =>
        senden(
          schreiben(LogAuszug, {
            typ: "log_auszug",
            protokoll: PROTOKOLL_VERSION,
            auftragId: n.auftragId,
            zeilen,
          }),
        ),
      );
      await abschliessen(stand, n.auftragId, ergebnis, senden);
    } finally {
      laufend.delete(n.auftragId);
    }
  };

  const empfangen: Auftraege["empfangen"] = async (n, senden) => {
    geladen ??= standLaden(deps.dateien, deps.pfad);
    const record = await geladen;
    if (!record.ok) {
      // without its record the agent cannot tell a job sent twice: it runs none, and reads the
      // record again with the next job, so a repaired one counts without a restart
      geladen = undefined;
      deps.log("job refused", { auftragId: n.auftragId, grund: record.grund });
      return;
    }
    const { stand } = record;
    const bekannt = stand.get(n.auftragId);
    if (bekannt?.zustand === "fertig") return ergebnisSenden(n.auftragId, bekannt.ergebnis, senden);
    senden(bestaetigt(n.auftragId));
    if (laufend.has(n.auftragId)) return;
    const geprueft = auftragPruefen(n, deps.vertrauen);
    if (!geprueft.ok)
      return abschliessen(
        stand,
        n.auftragId,
        { ok: false, fehler: `abgelehnt: ${geprueft.grund}` },
        senden,
      );
    // running when the agent stopped: it may have done part of its work
    if (bekannt?.zustand === "laeuft" && !geprueft.plan.idempotent)
      return abschliessen(stand, n.auftragId, { ok: false, fehler: NEU_GESTARTET }, senden);
    return starten(stand, n, geprueft.plan, senden);
  };

  return { empfangen };
};

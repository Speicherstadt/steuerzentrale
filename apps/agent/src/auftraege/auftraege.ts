import { AGENT_BINARY } from "@steuerzentrale/manifest";
import {
  Bestaetigt,
  Ergebnis as ErgebnisNachricht,
  Fortschritt,
  LogAuszug,
  PROTOKOLL_VERSION,
  schreiben,
} from "@steuerzentrale/protokoll";
import { type AgentUpdateDeps, agentAktualisieren } from "../agent-update/aktualisieren.ts";
import { type AktionsDeps, aktionAusfuehren } from "../aktionen/auftrag.ts";
import type { ZeilenLesen } from "../aktionen/journal.ts";
import { backupAusfuehren } from "../backup/auftrag.ts";
import type { Dateien } from "../dateien.ts";
import { einrichtungAusfuehren, installationsNutzer } from "../einrichtung/auftrag.ts";
import { type Gedaechtnis, gedaechtnisOeffnen } from "../einrichtung/gedaechtnis.ts";
import type { HausDateien } from "../einrichtung/haus.ts";
import type { NutzerLesen } from "../einrichtung/nutzer.ts";
import {
  type NeustartDeps,
  neustartAblehnen,
  neustartAusloesen,
  neustartEnde,
} from "../neustart/neustart.ts";
import { type PforteDeps, pforteAusfuehren } from "../pforte/ausfuehren.ts";
import {
  type PruefRestoreDeps,
  pruefRestoreAusfuehren,
  resteAbbauen,
} from "../pruef-restore/auftrag.ts";
import { updateAusfuehren } from "../update/auftrag.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import { wiederherstellenAufraeumen } from "../wiederherstellen/aufraeumen.ts";
import { wiederherstellenAusfuehren } from "../wiederherstellen/auftrag.ts";
import type { PruefDeps, SpawnMitAusgabe } from "../zustand/pruefen.ts";
import { ausfuehren as befehlAusfuehren, type Ergebnis, type Spawn } from "./ausfuehren.ts";
import {
  type AuftragNachricht,
  auftragPruefen,
  type JederPlan,
  type ServerNeustartPlan,
  type Vertrauen,
} from "./pruefen.ts";
import { type Geladen, type Stand, standLaden, standSchreiber } from "./zustand.ts";

/*
 * The agent's side of jobs (BAULISTE.md Z-305): it acknowledges a job, checks it (pruefen.ts),
 * reports that it runs, runs it (ausfuehren.ts as the installation's user; a job of the Pforte
 * through its admin API, src/pforte; a setup job by src/einrichtung; a restart or log excerpt by
 * src/aktionen, whose lines go out as `log_auszug` before the result; a backup job by src/backup;
 * a restore by src/wiederherstellen; an update by src/update; its own update by src/agent-update,
 * after which it takes no job and restarts; the reboot of its server by src/neustart, after which it
 * takes no job, and which it reports by the boot id once it runs again) and reports the result.
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
  /**
   * The agent's binary the backup's service runs (Z-601) and a Prüf-Restore plays back with
   * (Z-602); AGENT_BINARY without, other in tests
   */
  agent?: string;
  /** The health check of a Prüf-Restore's copy (Z-602), as the checks make it (src/zustand) */
  holen: PruefDeps["holen"];
  verbinden: PruefDeps["verbinden"];
  /** Only in the agent test: reads the copy of a Prüf-Restore while it runs (pruef-restore/auftrag.ts) */
  waehrendKopie?: PruefRestoreDeps["waehrendKopie"];
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
  /** Its own update (Z-504), without in tests that do not need it */
  agentUpdate?: AgentUpdateDeps;
  /** Ends the service once its own update holds; systemd starts the new binary */
  neustarten?: () => void;
  /** The reboot of the server (Z-701), without in tests that do not need it */
  neustart?: NeustartDeps;
};

export type Auftraege = {
  /** Handles a job; `senden` reaches the Zentrale over the current connection, if any */
  empfangen: (n: AuftragNachricht, senden: (text: string) => void) => Promise<void>;
  /**
   * Sets right what a job left when the agent stopped in its middle, called once when the service
   * starts: tears down a Prüf-Restore's copy (Z-602), in the line of the Prüf-Restores; stops a
   * restore's transient unit and starts the backup's timer (Z-603), in the line of the setups
   */
  aufraeumen: () => Promise<void>;
};

export const NEU_GESTARTET = "Agent neu gestartet";

/** The longest error text a result carries (packages/protokoll, `ergebnis`) */
const MAX_FEHLER = 2000;

const bestaetigt = (auftragId: string) =>
  schreiben(Bestaetigt, { typ: "bestaetigt", protokoll: PROTOKOLL_VERSION, auftragId });

const ergebnisNachricht = (auftragId: string, ergebnis: Ergebnis, zeit: number) =>
  schreiben(ErgebnisNachricht, {
    typ: "ergebnis",
    protokoll: PROTOKOLL_VERSION,
    auftragId,
    zeit,
    ergebnis,
  });

/** The lines of a log excerpt, sent before its result (docs/plan.md, "Log-Auszug") */
const auszugSender =
  (auftragId: string, senden: (text: string) => void) =>
  (zeilen: string[]): void =>
    senden(
      schreiben(LogAuszug, { typ: "log_auszug", protokoll: PROTOKOLL_VERSION, auftragId, zeilen }),
    );

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

/** Runs a checked plan by its kind: a command as the installation's user, or a built-in job */
const ausfuehrer = (
  deps: AuftraegeDeps,
  serverNeustarten: (plan: ServerNeustartPlan) => Promise<Ergebnis>,
) => {
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
  const { holen, verbinden, waehrendKopie } = deps.installationen;
  const pruef: PruefRestoreDeps = {
    ...backup,
    holen,
    verbinden,
    ...(waehrendKopie ? { waehrendKopie } : {}),
  };
  // one Prüf-Restore at a time, beside the setups: it may take hours and changes no installation
  const pruefReihe = reihe();
  // started with `void` (cli.ts): a rejection would end the service, so a throw is logged
  const gefangen = (e: unknown) => ({ ok: false as const, grund: String(e).slice(0, 500) });
  const kopienAbbauen = () =>
    pruefReihe(async () => {
      const r = await resteAbbauen(system).catch(gefangen);
      if (!r.ok) deps.log("pruef-restore leftovers not torn down", { grund: r.grund });
      else if (r.abgebaut.length > 0)
        deps.log("pruef-restore leftovers torn down", { kopien: r.abgebaut });
    });
  // in the line of the setups, where a restore runs: done before any job that came after the start
  const wiederherstellenReste = () =>
    einrichtungReihe(async () => {
      const r = await wiederherstellenAufraeumen(system).catch(gefangen);
      if (!r.ok) return deps.log("restore leftovers not cleaned up", { grund: r.grund });
      for (const f of r.fehler) deps.log("restore leftovers not cleaned up", f);
      if (r.installationen.length > 0)
        deps.log("restore leftovers cleaned up", { installationen: r.installationen });
    });
  const aufraeumen = async () => {
    await Promise.all([kopienAbbauen(), wiederherstellenReste()]);
  };
  const ausfuehren = async (
    plan: JederPlan,
    auftragId: string,
    auszugSenden: (zeilen: string[]) => void,
  ): Promise<Ergebnis> => {
    if (plan.art === "agent_update")
      return deps.agentUpdate
        ? agentAktualisieren(deps.agentUpdate, auftragId, plan.auftrag)
        : { ok: false, fehler: "abgelehnt: this agent cannot update itself" };
    if (plan.art === "server_neustart") return serverNeustarten(plan);
    if (plan.art === "pruef_restore") return pruefReihe(() => pruefRestoreAusfuehren(pruef, plan));
    if (plan.art === "pforte") return pforteReihe(() => pforteAusfuehren(deps, plan));
    if (plan.art === "einrichtung")
      return einrichtungReihe(() => einrichtungAusfuehren(system, plan));
    if (plan.art === "aktion")
      return einrichtungReihe(() => aktionAusfuehren(system, plan, auszugSenden));
    // a restore stops and starts the installation's units: never beside a setup or an action
    if (plan.art === "wiederherstellen")
      return einrichtungReihe(() => wiederherstellenAusfuehren(pruef, plan));
    // an update likewise, and it may roll back with a restore (Z-503)
    if (plan.art === "update") return einrichtungReihe(() => updateAusfuehren(pruef, plan));
    // setting up a backup writes into the home like a setup; a run may take hours and waits for none
    if (plan.art === "backup")
      return plan.auftrag.art === "einrichten"
        ? einrichtungReihe(() => backupAusfuehren(backup, plan))
        : backupAusfuehren(backup, plan);
    const als = await installationsNutzer(system, plan.installationId);
    if (!als.ok) return { ok: false, fehler: `abgelehnt: ${als.grund}` };
    return befehlAusfuehren(deps, plan, als.nutzer);
  };
  return { ausfuehren, aufraeumen };
};

/**
 * Its own update while it runs: a job that comes meanwhile waits for its end, since the restart
 * after it would end that job halfway (and after a failed one, it runs)
 */
const updateWache = () => {
  let laufend: { auftragId: string; ende: Promise<void> } | undefined;
  return {
    abwarten: async (auftragId: string) => {
      while (laufend && laufend.auftragId !== auftragId) await laufend.ende;
    },
    halten: async (auftragId: string, lauf: Promise<void>) => {
      const dieses = { auftragId, ende: lauf.catch(() => {}) };
      laufend = dieses;
      try {
        await lauf;
      } finally {
        if (laufend === dieses) laufend = undefined;
      }
    },
  };
};

export const auftraegeAnnehmen = (deps: AuftraegeDeps): Auftraege => {
  const schreibe = standSchreiber(deps.dateien, deps.pfad, deps.jetzt);
  let geladen: Promise<Geladen> | undefined;
  const laufend = new Set<string>();
  // its own update holds or the server reboots: a job sent now is sent again after the restart
  let neustartFolgt = false;
  const eigenesUpdate = updateWache();
  const ohneNeustart: Ergebnis = { ok: false, fehler: "abgelehnt: this agent cannot reboot" };
  /** Out of the job's boot only; from asking systemd on, no job starts until it failed */
  const serverNeustarten = async (plan: ServerNeustartPlan): Promise<Ergebnis> => {
    if (!deps.neustart) return ohneNeustart;
    const abgelehnt = await neustartAblehnen(deps.neustart, plan.auftrag);
    if (abgelehnt) return abgelehnt;
    neustartFolgt = true;
    try {
      return await neustartAusloesen(deps.neustart);
    } finally {
      neustartFolgt = false;
    }
  };
  const { ausfuehren: planAusfuehren, aufraeumen } = ausfuehrer(deps, serverNeustarten);

  const ergebnisSenden = (auftragId: string, ergebnis: Ergebnis, senden: (t: string) => void) =>
    senden(ergebnisNachricht(auftragId, ergebnis, deps.jetzt()));

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
      // the restart after its own update, and a reboot, would end any other job halfway
      const allein = plan.art === "agent_update" || plan.art === "server_neustart";
      const ergebnis =
        allein && laufend.size > 1
          ? { ok: false as const, fehler: "abgelehnt: other jobs run on the agent" }
          : await planAusfuehren(plan, n.auftragId, auszugSender(n.auftragId, senden));
      if (plan.art === "agent_update" && ergebnis.ok) neustartFolgt = true;
      await abschliessen(stand, n.auftragId, ergebnis, senden);
      if (plan.art === "agent_update" && ergebnis.ok) deps.neustarten?.();
    } finally {
      laufend.delete(n.auftragId);
    }
  };

  const empfangen: Auftraege["empfangen"] = async (n, senden) => {
    await eigenesUpdate.abwarten(n.auftragId);
    if (neustartFolgt) return deps.log("job left for the new agent", { auftragId: n.auftragId });
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
    // a reboot running when the agent stopped: the boot id tells whether it came (Z-701)
    if (bekannt?.zustand === "laeuft" && geprueft.plan.art === "server_neustart") {
      const ende = deps.neustart ? neustartEnde(deps.neustart, geprueft.plan.auftrag) : undefined;
      return abschliessen(stand, n.auftragId, (await ende) ?? ohneNeustart, senden);
    }
    // running when the agent stopped: it may have done part of its work
    if (bekannt?.zustand === "laeuft" && !geprueft.plan.idempotent)
      return abschliessen(stand, n.auftragId, { ok: false, fehler: NEU_GESTARTET }, senden);
    const laeuft = starten(stand, n, geprueft.plan, senden);
    return geprueft.plan.art === "agent_update"
      ? eigenesUpdate.halten(n.auftragId, laeuft)
      : laeuft;
  };

  return { empfangen, aufraeumen };
};

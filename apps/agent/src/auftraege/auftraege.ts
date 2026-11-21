import {
  Bestaetigt,
  Ergebnis as ErgebnisNachricht,
  Fortschritt,
  PROTOKOLL_VERSION,
  schreiben,
} from "@steuerzentrale/protokoll";
import type { Dateien } from "../dateien.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import { ausfuehren, type Ergebnis, type Spawn } from "./ausfuehren.ts";
import { type AuftragNachricht, auftragPruefen, type Vertrauen } from "./pruefen.ts";
import { type Geladen, type Stand, standLaden, standSchreiber } from "./zustand.ts";

/*
 * The agent's side of jobs (BAULISTE.md Z-305): it acknowledges a job, checks it (pruefen.ts),
 * reports that it runs, runs it (ausfuehren.ts) and reports the result. Idempotent by the job's
 * id through its record (zustand.ts): a finished job sent again gets its stored result, a running
 * one only an acknowledgement. A job that was running when the agent stopped is reported failed
 * ("Agent neu gestartet") when the Zentrale sends it again after the restart; only a command the
 * manifest marks `idempotent` is run again instead (docs/plan.md, "Aufträge").
 */

export type AuftraegeDeps = {
  dateien: Dateien;
  /** The record's file (pfade.ts, `auftraege`) */
  pfad: string;
  vertrauen: Vertrauen;
  spawn: Spawn;
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

export const auftraegeAnnehmen = (deps: AuftraegeDeps): Auftraege => {
  const schreibe = standSchreiber(deps.dateien, deps.pfad, deps.jetzt);
  let geladen: Promise<Geladen> | undefined;
  const laufend = new Set<string>();

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
    plan: Parameters<typeof ausfuehren>[1],
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
      const ergebnis = await ausfuehren(deps, plan);
      await abschliessen(stand, n.auftragId, ergebnis, senden);
    } finally {
      laufend.delete(n.auftragId);
    }
  };

  const empfangen: Auftraege["empfangen"] = async (n, senden) => {
    geladen ??= standLaden(deps.dateien, deps.pfad);
    const record = await geladen;
    if (!record.ok) {
      // without its record the agent cannot tell a job sent twice: it runs none
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

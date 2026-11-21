import { type AuftragZustand, uebergang } from "@steuerzentrale/protokoll";
import type { Db } from "../../db/oeffnen.ts";
import type { Schreiber } from "../audit/index.ts";
import { type Auftrag, auftraegeImZustand, vorgaengerVon, zustaendeLesen } from "./lesen.ts";

/*
 * Jobs that wait for others (BAULISTE.md Z-305; docs/plan.md, "Aufträge"): a job becomes ready
 * once every predecessor succeeded, on whatever server or installation of its operator, and is
 * cancelled once one failed or was cancelled; its own waiting jobs follow it.
 */

const GESCHEITERT: ReadonlySet<AuftragZustand> = new Set(["gescheitert", "abgebrochen"]);

/** Where a new job starts, by the states of its predecessors */
export const startzustand = (vorgaenger: readonly AuftragZustand[]): AuftragZustand => {
  if (vorgaenger.some((z) => GESCHEITERT.has(z))) return "abgebrochen";
  return vorgaenger.every((z) => z === "erfolgreich") ? "bereit" : "wartend";
};

/**
 * Whether the new job would wait for itself, through any chain of predecessors; `vorgaenger`
 * names the ids a known job waits for
 */
export const zyklusIn = (
  neu: { id: string; wartetAuf: readonly string[] },
  vorgaenger: (id: string) => readonly string[],
): boolean => {
  const gesehen = new Set<string>();
  const offen = [...neu.wartetAuf];
  while (offen.length > 0) {
    const id = offen.pop() as string;
    if (id === neu.id) return true;
    if (gesehen.has(id)) continue;
    gesehen.add(id);
    offen.push(...vorgaenger(id));
  }
  return false;
};

/**
 * After the job `fertig` reached an end state: each waiting job of the operator that waits for
 * it becomes ready or cancelled, and a cancelled one passes that on to its own waiting jobs. Runs
 * inside the transaction of `fertig`'s change; returns the jobs that became ready, to be sent.
 */
export const nachfolgerFortschreiben = (
  w: Schreiber,
  db: Db,
  fertig: { betreiberId: string; auftragId: string; zustand: AuftragZustand },
  jetzt: number,
): Auftrag[] => {
  const wartend = auftraegeImZustand(db, fertig.betreiberId, "wartend");
  const neu = new Map<string, AuftragZustand>([[fertig.auftragId, fertig.zustand]]);
  const bereit: Auftrag[] = [];
  const offen = [fertig.auftragId];
  while (offen.length > 0) {
    const id = offen.shift() as string;
    for (const a of wartend.filter((x) => !neu.has(x.auftragId) && vorgaengerVon(x).includes(id))) {
      const ids = vorgaengerVon(a);
      const bekannt = zustaendeLesen(db, fertig.betreiberId, ids);
      const stand = ids.map((v) => ({ id: v, zustand: neu.get(v) ?? bekannt.get(v) ?? "wartend" }));
      const gescheitert = stand.find((v) => GESCHEITERT.has(v.zustand));
      if (!gescheitert && !stand.every((v) => v.zustand === "erfolgreich")) continue;
      const u = uebergang(a.zustand, {
        art: gescheitert ? "vorgaenger_gescheitert" : "vorgaenger_erfolgreich",
      });
      if (!u.ok) continue;
      const ergebnis = gescheitert && {
        ergebnis: JSON.stringify({
          ok: false,
          fehler: `Vorgänger ${gescheitert.id} ${gescheitert.zustand}`,
        }),
      };
      const zeile = w.aendern(
        "auftraege",
        { auftragId: a.auftragId },
        { zustand: u.zustand, geaendertAm: jetzt, ...ergebnis },
      );
      neu.set(a.auftragId, u.zustand);
      if (u.zustand === "bereit") bereit.push(zeile);
      else offen.push(a.auftragId);
    }
  }
  return bereit;
};

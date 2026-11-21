import {
  type AuftragEreignis,
  ENDZUSTAENDE,
  type NachrichtVomAgenten,
  uebergang,
} from "@steuerzentrale/protokoll";
import { fortschrittSetzen, schreiben } from "../audit/index.ts";
import type { Server } from "../server/index.ts";
import { nachfolgerFortschreiben } from "./abhaengigkeiten.ts";
import { type Auftrag, auftragLesen } from "./lesen.ts";
import { type AuftragDeps, zustellen } from "./zustellen.ts";

/*
 * What an agent reports about its jobs (BAULISTE.md Z-305): it acknowledges a job, reports steps
 * and its result. An agent reports only jobs of its own server; a report the state of the job does
 * not allow is refused, and one that repeats what is known changes nothing. Each change of state
 * goes through `schreiben`; a step of a running job is a measurement (docs/plan.md, "Aufträge").
 * A job that ends moves its waiting jobs on, which go to their agents at once.
 */

export type AuftragsMeldung = Extract<
  NachrichtVomAgenten,
  { typ: "bestaetigt" | "fortschritt" | "ergebnis" }
>;

export type Gemeldet = { ok: true; geaendert: boolean } | { ok: false; grund: string };

const ereignisVon = (n: AuftragsMeldung): AuftragEreignis =>
  n.typ === "ergebnis" ? { art: "ergebnis", ok: n.ergebnis.ok } : { art: n.typ };

const aenderungVon = (n: AuftragsMeldung, jetzt: number): Partial<Auftrag> => {
  if (n.typ === "ergebnis") return { ergebnis: JSON.stringify(n.ergebnis) };
  if (n.typ === "fortschritt") return { fortschritt: n.schritt, fortschrittAm: jetzt };
  return {};
};

export const auftragMelden = (
  deps: AuftragDeps,
  server: Server,
  n: AuftragsMeldung,
  jetzt: number,
): Gemeldet => {
  const { betreiberId, serverId } = server;
  const a = auftragLesen(deps.db, betreiberId, n.auftragId);
  if (!a || a.serverId !== serverId) return { ok: false, grund: "not a job of this server" };
  const u = uebergang(a.zustand, ereignisVon(n));
  if (!u.ok) return u;
  if (!u.geaendert) {
    if (n.typ === "fortschritt")
      fortschrittSetzen(deps.schreibDb, {
        betreiberId,
        auftragId: a.auftragId,
        schritt: n.schritt,
        zeitpunkt: jetzt,
      });
    return { ok: true, geaendert: false };
  }
  const kontext = { betreiberId, akteur: `server:${serverId}`, jetzt, grund: "Agent meldet" };
  const bereit = schreiben(deps.schreibDb, kontext, `auftrag.${n.typ}`, (w) => {
    w.aendern(
      "auftraege",
      { auftragId: a.auftragId },
      { zustand: u.zustand, geaendertAm: jetzt, ...aenderungVon(n, jetzt) },
    );
    return ENDZUSTAENDE.has(u.zustand)
      ? nachfolgerFortschreiben(
          w,
          deps.db,
          { betreiberId, auftragId: a.auftragId, zustand: u.zustand },
          jetzt,
        )
      : [];
  });
  zustellen(deps, bereit);
  return { ok: true, geaendert: true };
};

import { randomUUID } from "node:crypto";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { kundeLesen } from "../kunden/index.ts";
import { type Dienst, dienstLesen, dienstZeileLesen } from "./lesen.ts";

export { type Dienst, diensteListe, dienstLesen } from "./lesen.ts";

/*
 * Observed services (BAULISTE.md Z-1101): made, changed and removed through `schreiben`, each with
 * its entry in the audit log; the reason is the action's own, nobody is asked for one (BAULISTE.md,
 * Stufe 2). A customer must be one of the operator's. Removing keeps the row with `entfernt_am`, so
 * events and measurements still name the service until the retention ends them.
 */

/** What the operator enters about a service; host and path already checked (adresse.ts) */
export type DienstDaten = {
  name: string;
  host: string;
  pfad: string;
  kundeId: string | null;
};

export type Ergebnis =
  | { ok: true; dienst: Dienst }
  | { ok: false; grund: "kein_dienst" | "kein_kunde" };

const kundeFehlt = (db: Db, betreiberId: string, kundeId: string | null) =>
  kundeId !== null && kundeLesen(db, betreiberId, kundeId) === undefined;

const gelesen = (db: Db, kontext: Kontext, dienstId: string): Ergebnis => {
  const dienst = dienstLesen(db, kontext.betreiberId, dienstId, kontext.jetzt);
  return dienst ? { ok: true, dienst } : { ok: false, grund: "kein_dienst" };
};

export const dienstAnlegen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  daten: DienstDaten,
): Ergebnis => {
  if (kundeFehlt(db, kontext.betreiberId, daten.kundeId)) return { ok: false, grund: "kein_kunde" };
  const dienstId = randomUUID();
  schreiben(schreibDb, kontext, "dienst.anlegen", (s) =>
    s.einfuegen("dienste", {
      betreiberId: kontext.betreiberId,
      dienstId,
      ...daten,
      angelegtAm: kontext.jetzt,
    }),
  );
  return gelesen(db, kontext, dienstId);
};

export const dienstAendern = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  dienstId: string,
  daten: DienstDaten,
): Ergebnis => {
  const alt = dienstZeileLesen(db, kontext.betreiberId, dienstId);
  if (!alt) return { ok: false, grund: "kein_dienst" };
  if (kundeFehlt(db, kontext.betreiberId, daten.kundeId)) return { ok: false, grund: "kein_kunde" };
  const geaendert = Object.fromEntries(
    Object.entries(daten).filter(([feld, wert]) => alt[feld as keyof DienstDaten] !== wert),
  );
  if (Object.keys(geaendert).length > 0)
    schreiben(schreibDb, kontext, "dienst.aendern", (s) =>
      s.aendern("dienste", { dienstId }, geaendert),
    );
  return gelesen(db, kontext, dienstId);
};

export const dienstEntfernen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  dienstId: string,
): { ok: true } | { ok: false; grund: "kein_dienst" } => {
  if (!dienstZeileLesen(db, kontext.betreiberId, dienstId))
    return { ok: false, grund: "kein_dienst" };
  schreiben(schreibDb, kontext, "dienst.entfernen", (s) =>
    s.aendern("dienste", { dienstId }, { entferntAm: kontext.jetzt }),
  );
  return { ok: true };
};

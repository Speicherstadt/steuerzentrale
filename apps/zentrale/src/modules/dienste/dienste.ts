import { randomUUID } from "node:crypto";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { kundeLesen } from "../kunden/index.ts";
import { type Innen, type InnenFehler, innenPruefen, innenSpalten } from "./innen.ts";
import { type Dienst, dienstLesen, dienstZeileLesen } from "./lesen.ts";

export { type Dienst, diensteListe, dienstLesen } from "./lesen.ts";

/*
 * Observed services (BAULISTE.md Z-1101): made, changed and removed through `schreiben`, each with
 * its entry in the audit log; the reason is the action's own, nobody is asked for one (BAULISTE.md,
 * Stufe 2). A customer must be one of the operator's. Removing keeps the row with `entfernt_am`, so
 * events and measurements still name the service until the retention ends them. Its inside
 * (Z-1103) only on one of the operator's servers that is only observed (innen.ts).
 */

/** What the operator enters about a service; host and path already checked (adresse.ts) */
export type DienstDaten = {
  name: string;
  host: string;
  pfad: string;
  kundeId: string | null;
  /** What the agent reads inside (Z-1103); null: only from outside */
  innen: Innen | null;
};

export type Ergebnis =
  | { ok: true; dienst: Dienst }
  | { ok: false; grund: "kein_dienst" | "kein_kunde" | InnenFehler };

/** The columns of the service as stored */
const spalten = ({ innen, ...rest }: DienstDaten) => ({ ...rest, ...innenSpalten(innen) });

/** Why the data cannot be taken, or undefined */
const fehler = (db: Db, betreiberId: string, daten: DienstDaten) =>
  kundeFehlt(db, betreiberId, daten.kundeId)
    ? ("kein_kunde" as const)
    : innenPruefen(db, betreiberId, daten.innen);

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
  const grund = fehler(db, kontext.betreiberId, daten);
  if (grund) return { ok: false, grund };
  const dienstId = randomUUID();
  schreiben(schreibDb, kontext, "dienst.anlegen", (s) =>
    s.einfuegen("dienste", {
      betreiberId: kontext.betreiberId,
      dienstId,
      ...spalten(daten),
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
  const grund = fehler(db, kontext.betreiberId, daten);
  if (grund) return { ok: false, grund };
  const geaendert = Object.fromEntries(
    Object.entries(spalten(daten)).filter(([feld, wert]) => alt[feld as keyof typeof alt] !== wert),
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

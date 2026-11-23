import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import { and, eq, lt } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { auditLog } from "../../db/schema.ts";
import {
  type AufbewahrteTabelle,
  ausgelasseneSpalten,
  istGlobal,
  type Tabelle,
  type TabellenName,
  tabellen,
  verschluesselteSpalten,
} from "./tabellen.ts";

/**
 * Who writes, for which operator, when and why (docs/plan.md, "Sicherheit": every write with a
 * reason). `auchFuer` names further operators whose audit logs get the same entries: only for a
 * change of `global` tables alone, such as a manifest the command imports for all (Z-501)
 */
export type Kontext = {
  betreiberId: string;
  akteur: string;
  jetzt: number;
  grund: string;
  auchFuer?: readonly string[];
};

type Zeile<N extends TabellenName> = InferSelectModel<Tabelle<N>>;
type Neu<N extends TabellenName> = InferInsertModel<Tabelle<N>>;
type Schluessel<N extends TabellenName> = Partial<Zeile<N>>;

/** The only way to change a table of the Zentrale: each call appends to the audit log */
export type Schreiber = {
  einfuegen: <N extends TabellenName>(name: N, werte: Neu<N>) => Zeile<N>;
  aendern: <N extends TabellenName>(
    name: N,
    schluessel: Schluessel<N>,
    werte: Partial<Neu<N>>,
  ) => Zeile<N>;
  loeschen: <N extends TabellenName>(name: N, schluessel: Schluessel<N>) => Zeile<N>;
  /** Whether the operator's row exists, as this transaction sees it (the read-only `db` does not) */
  vorhanden: <N extends TabellenName>(name: N, schluessel: Schluessel<N>) => boolean;
  /** Deletes the operator's rows older than `grenze` (retention); returns how many */
  loeschenVor: (name: AufbewahrteTabelle, grenze: number) => number;
};

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const spalte = (name: TabellenName, feld: string): SQLiteColumn =>
  (tabellen[name].tabelle as unknown as Record<string, SQLiteColumn>)[feld] as SQLiteColumn;

/** The row named by its key, always within the writer's operator (a `global` table has none) */
const wo = (name: TabellenName, betreiberId: string, schluessel: Record<string, unknown>): SQL => {
  const fehlt = tabellen[name].schluessel.filter((feld) => schluessel[feld] === undefined);
  if (fehlt.length > 0) throw new Error(`${name}: key ${fehlt.join(", ")} missing`);
  const bedingungen = tabellen[name].schluessel.map((feld) =>
    eq(spalte(name, feld), schluessel[feld]),
  );
  return istGlobal(name)
    ? (and(...bedingungen) as SQL)
    : (and(eq(spalte(name, "betreiberId"), betreiberId), ...bedingungen) as SQL);
};

const zielVon = (name: TabellenName, zeile: Record<string, unknown>): string =>
  [name, ...tabellen[name].schluessel.map((feld) => String(zeile[feld]))].join(":");

/** A row or change as the audit log keeps it: encrypted and left-out values only marked, never copied */
const fuerAudit = (name: TabellenName, werte: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(werte).map(([feld, wert]) => {
      if (verschluesselteSpalten[name]?.includes(feld)) return [feld, "[verschlüsselt]"];
      return ausgelasseneSpalten[name]?.includes(feld) ? [feld, "[ausgelassen]"] : [feld, wert];
    }),
  );

const eineZeile = <T>(zeilen: T[], name: string): T => {
  if (zeilen.length !== 1) throw new Error(`${name}: expected one row, found ${zeilen.length}`);
  return zeilen[0] as T;
};

/** Only a `global` table may be written for several operators' audit logs at once */
const pruefen = (name: TabellenName, kontext: Kontext): void => {
  if ((kontext.auchFuer?.length ?? 0) > 0 && !istGlobal(name))
    throw new Error(`${name}: written for several operators, but holds an operator's data`);
};

const schreiberFuer = (tx: Tx, kontext: Kontext, aktion: string): Schreiber => {
  const betreiberIds = [...new Set([kontext.betreiberId, ...(kontext.auchFuer ?? [])])];
  const anhaengen = (ziel: string, inhalt: unknown): void => {
    for (const betreiberId of betreiberIds)
      tx.insert(auditLog)
        .values({
          betreiberId,
          zeitpunkt: kontext.jetzt,
          akteur: kontext.akteur,
          aktion,
          ziel,
          grund: kontext.grund,
          inhalt: JSON.stringify(inhalt),
        })
        .run();
  };
  return {
    einfuegen: (name, werte) => {
      pruefen(name, kontext);
      if (
        !istGlobal(name) &&
        (werte as { betreiberId?: string }).betreiberId !== kontext.betreiberId
      )
        throw new Error(`${name}: row of another operator`);
      const zeile = eineZeile(
        tx
          .insert(tabellen[name].tabelle)
          .values(werte as never)
          .returning()
          .all(),
        name,
      ) as Record<string, unknown>;
      anhaengen(zielVon(name, zeile), { art: "einfuegen", zeile: fuerAudit(name, zeile) });
      return zeile as never;
    },
    aendern: (name, schluessel, werte) => {
      pruefen(name, kontext);
      const neu = { ...werte } as Record<string, unknown>;
      for (const feld of ["betreiberId", ...tabellen[name].schluessel]) delete neu[feld];
      const zeile = eineZeile(
        tx
          .update(tabellen[name].tabelle)
          .set(neu)
          .where(wo(name, kontext.betreiberId, schluessel))
          .returning()
          .all(),
        name,
      ) as Record<string, unknown>;
      anhaengen(zielVon(name, zeile), { art: "aendern", werte: fuerAudit(name, neu) });
      return zeile as never;
    },
    loeschen: (name, schluessel) => {
      pruefen(name, kontext);
      const zeile = eineZeile(
        tx
          .delete(tabellen[name].tabelle)
          .where(wo(name, kontext.betreiberId, schluessel))
          .returning()
          .all(),
        name,
      ) as Record<string, unknown>;
      anhaengen(zielVon(name, zeile), { art: "loeschen", zeile: fuerAudit(name, zeile) });
      return zeile as never;
    },
    vorhanden: (name, schluessel) =>
      tx
        .select()
        .from(tabellen[name].tabelle as never)
        .where(wo(name, kontext.betreiberId, schluessel))
        .all().length > 0,
    loeschenVor: (name, grenze) => {
      pruefen(name, kontext);
      const { tabelle, zeit } = tabellen[name];
      // bun:sqlite's run() reports no row count through Drizzle; the deleted instants do
      const geloescht = tx
        .delete(tabelle)
        .where(and(eq(spalte(name, "betreiberId"), kontext.betreiberId), lt(zeit, grenze)))
        .returning({ zeitpunkt: zeit })
        .all().length;
      anhaengen(name, { art: "loeschenVor", grenze, geloescht });
      return geloescht;
    },
  };
};

/**
 * Runs `aenderung` in one transaction; every write appends its entry to the audit log in the same
 * transaction, so an error anywhere takes back the rows and their entries together
 */
export const schreiben = <T>(
  schreibDb: SchreibDb,
  kontext: Kontext,
  aktion: string,
  aenderung: (schreiber: Schreiber) => T,
): T =>
  schreibDb.verbindung.transaction((tx) => {
    let beendet = false;
    const schreiber = schreiberFuer(tx, kontext, aktion);
    // bun:sqlite commits when the callback returns: a write after an `await` would land outside
    // the transaction, and an error after it would take nothing back
    const bewacht = Object.fromEntries(
      Object.entries(schreiber).map(([name, f]) => [
        name,
        (...args: unknown[]) => {
          if (beendet) throw new Error(`${aktion}: write after the transaction ended`);
          return (f as (...a: unknown[]) => unknown)(...args);
        },
      ]),
    ) as Schreiber;
    const ergebnis = aenderung(bewacht);
    beendet = true;
    if (ergebnis instanceof Promise) {
      ergebnis.catch(() => {});
      throw new Error(`${aktion}: schreiben takes a synchronous change`);
    }
    return ergebnis;
  });

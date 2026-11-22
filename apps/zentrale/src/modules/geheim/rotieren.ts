import type { Datenbank } from "../../db/oeffnen.ts";
import { betreiber } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import { type TabellenName, tabellen, verschluesselteSpalten } from "../audit/tabellen.ts";
import { spaltenZweck } from "./spalten.ts";
import { entschluesseln, schluesselIdVon, verschluesseln } from "./verschluesseln.ts";

type Zeile = Record<string, unknown> & { betreiberId: string };
type Neuverschluesselt = {
  name: TabellenName;
  betreiberId: string;
  schluessel: Record<string, unknown>;
  werte: Record<string, unknown>;
};

const ort = (name: TabellenName, zeile: Zeile) =>
  [name, zeile.betreiberId, ...tabellen[name].schluessel.map((f) => String(zeile[f]))].join("/");

/** The rows of one table with a value in `spalte` that the current key did not encrypt */
const offeneZeilen = (datenbank: Datenbank, name: TabellenName, spalte: string): Zeile[] =>
  (
    datenbank.db
      .select()
      .from(tabellen[name].tabelle as never)
      .all() as Zeile[]
  ).filter(
    (zeile) =>
      typeof zeile[spalte] === "string" &&
      schluesselIdVon(zeile[spalte] as string) !== datenbank.schluessel.aktuell.id,
  );

/** Every value of one encrypted column, decrypted and encrypted anew with the current key */
const neuVerschluesseln = (
  datenbank: Datenbank,
  name: TabellenName,
  spalte: string,
  betreiberIds: ReadonlySet<string>,
  jetzt: number,
): Neuverschluesselt[] => {
  const { schluessel } = datenbank;
  const alle = [schluessel.aktuell, ...schluessel.alt];
  return offeneZeilen(datenbank, name, spalte).map((zeile) => {
    // A secret of an operator that no longer exists could not be written through the audit log
    // and would stay with the old key, unreadable once that key is gone
    if (!betreiberIds.has(zeile.betreiberId))
      throw new Error(`secret ${ort(name, zeile)} has no operator`);
    const zweck = spaltenZweck(name, zeile.betreiberId, zeile);
    const klar = entschluesseln(alle, zweck, zeile[spalte] as string);
    if (!klar.ok) throw new Error(`secret ${ort(name, zeile)} cannot be decrypted: ${klar.grund}`);
    return {
      name,
      betreiberId: zeile.betreiberId,
      schluessel: Object.fromEntries(tabellen[name].schluessel.map((f) => [f, zeile[f]])),
      werte: {
        [spalte]: verschluesseln(schluessel.aktuell, zweck, klar.wert),
        ...("geaendertAm" in zeile ? { geaendertAm: jetzt } : {}),
      },
    };
  });
};

/**
 * Encrypts every secret anew with the current key (`steuerzentrale schluessel-rotieren`, the old key
 * in STEUERZENTRALE_SECRET_KEY_ALT), in every encrypted column of every table
 * (`verschluesselteSpalten`). All values are decrypted first: one that no key opens stops the
 * rotation before anything is written. Returns how many values were encrypted anew.
 */
export const rotieren = (datenbank: Datenbank, jetzt: number): number => {
  const betreiberIds = new Set(
    datenbank.db
      .select({ id: betreiber.betreiberId })
      .from(betreiber)
      .all()
      .map((zeile) => zeile.id),
  );
  const neu = Object.entries(verschluesselteSpalten).flatMap(([name, spalten]) =>
    (spalten ?? []).flatMap((spalte) =>
      neuVerschluesseln(datenbank, name as TabellenName, spalte, betreiberIds, jetzt),
    ),
  );
  for (const betreiberId of betreiberIds) {
    const eigene = neu.filter((zeile) => zeile.betreiberId === betreiberId);
    if (eigene.length === 0) continue;
    const kontext = { betreiberId, akteur: "system", jetzt, grund: "Schlüssel rotiert" };
    schreiben(datenbank.schreibDb, kontext, "schluessel.rotieren", (s) => {
      for (const zeile of eigene) s.aendern(zeile.name, zeile.schluessel as never, zeile.werte);
    });
  }
  datenbank.rotationAbschliessen();
  return neu.length;
};

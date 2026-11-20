import type { Database } from "bun:sqlite";
import {
  entschluesseln,
  type Schluessel,
  schluesselIdVon,
  verschluesseln,
} from "../modules/geheim/verschluesseln.ts";

/*
 * The check value of the database: one value encrypted with the current key, so a start with a
 * wrong STEUERZENTRALE_SECRET_KEY stops at once, before anything is written with it, even while
 * the database holds no secret yet. Like the migrations' bookkeeping it is the Zentrale's own and
 * outside the audit log.
 */
const ZWECK = "zentrale_schluessel";
const INHALT = "steuerzentrale";

export type Schluesselbund = { aktuell: Schluessel; alt: readonly Schluessel[] };

const tabelleAnlegen = (sqlite: Database) =>
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS zentrale_schluessel (id INTEGER PRIMARY KEY CHECK (id = 1), pruefwert TEXT NOT NULL)",
  );

const pruefwertSchreiben = (sqlite: Database, schluessel: Schluessel): void => {
  sqlite
    .query(
      "INSERT INTO zentrale_schluessel (id, pruefwert) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET pruefwert = excluded.pruefwert",
    )
    .run(verschluesseln(schluessel, ZWECK, INHALT));
};

/**
 * Refuses a key that does not open this database; the current key or, during a rotation, an old one
 * must open the check value. A new database gets its check value with the current key.
 */
export const schluesselPruefen = (sqlite: Database, bund: Schluesselbund): void => {
  tabelleAnlegen(sqlite);
  const zeile = sqlite
    .query<{ pruefwert: string }, []>("SELECT pruefwert FROM zentrale_schluessel WHERE id = 1")
    .get();
  if (!zeile) {
    pruefwertSchreiben(sqlite, bund.aktuell);
    return;
  }
  const geprueft = entschluesseln([bund.aktuell, ...bund.alt], ZWECK, zeile.pruefwert);
  if (!geprueft.ok || geprueft.wert !== INHALT)
    throw new Error(
      `STEUERZENTRALE_SECRET_KEY does not open this database (key ${bund.aktuell.id}, database encrypted with ${schluesselIdVon(zeile.pruefwert) ?? "unknown"})`,
    );
};

/** After a rotation: the check value from now on with the new key */
export const pruefwertErneuern = (sqlite: Database, schluessel: Schluessel): void => {
  tabelleAnlegen(sqlite);
  pruefwertSchreiben(sqlite, schluessel);
};

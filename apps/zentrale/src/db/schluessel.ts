import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
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

/*
 * Better Auth's secret (it signs the session cookies and encrypts the TOTP secrets): 32 random bytes
 * made on the first start and kept in the database, encrypted with STEUERZENTRALE_SECRET_KEY.
 * Derived from that key, a rotation would end every session and leave every TOTP secret unreadable
 * once the old key is gone; kept like this it is re-encrypted with the rotation instead
 * (docs/plan.md, "Anmeldung an der Zentrale").
 */
const AUTH_ZWECK = "zentrale_anmeldung";

const authTabelleAnlegen = (sqlite: Database) =>
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS zentrale_anmeldung (id INTEGER PRIMARY KEY CHECK (id = 1), geheimnis TEXT NOT NULL)",
  );

const authGeheimnisSchreiben = (sqlite: Database, schluessel: Schluessel, wert: string): void => {
  sqlite
    .query(
      "INSERT INTO zentrale_anmeldung (id, geheimnis) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET geheimnis = excluded.geheimnis",
    )
    .run(verschluesseln(schluessel, AUTH_ZWECK, wert));
};

/** Better Auth's secret, made on the first call; refuses one that no key of `bund` opens */
export const anmeldeGeheimnis = (sqlite: Database, bund: Schluesselbund): string => {
  authTabelleAnlegen(sqlite);
  const zeile = sqlite
    .query<{ geheimnis: string }, []>("SELECT geheimnis FROM zentrale_anmeldung WHERE id = 1")
    .get();
  if (!zeile) {
    const neu = randomBytes(32).toString("base64");
    authGeheimnisSchreiben(sqlite, bund.aktuell, neu);
    return neu;
  }
  const geoeffnet = entschluesseln([bund.aktuell, ...bund.alt], AUTH_ZWECK, zeile.geheimnis);
  if (!geoeffnet.ok) throw new Error(`the sign-in secret cannot be decrypted: ${geoeffnet.grund}`);
  return geoeffnet.wert;
};

/** After a rotation: Better Auth's secret, unchanged, from now on encrypted with the current key */
export const anmeldeGeheimnisErneuern = (sqlite: Database, bund: Schluesselbund): void => {
  authGeheimnisSchreiben(sqlite, bund.aktuell, anmeldeGeheimnis(sqlite, bund));
};

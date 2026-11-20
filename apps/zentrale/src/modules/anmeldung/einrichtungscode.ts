import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { mitglieder, tokens } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import { tokenAnlegen, tokenFinden } from "../geheim/index.ts";

/*
 * The setup code for the first owner (docs/plan.md, "Anmeldung an der Zentrale"): made at a start
 * while no one is a member of any operator, written to the log once (the one exception to "no
 * secret in a log"), valid for 24 hours and once, stored only as its hash. Its row reserves the id
 * of the operator that the first owner creates with it, so the token and its audit entries carry a
 * betreiber_id before the operator exists.
 */
export const EINRICHTUNG_ZWECK = "einrichtung";
export const EINRICHTUNG_GUELTIG_MS = 24 * 60 * 60 * 1000;

/** Whether the Zentrale still waits for its first owner: no membership exists */
export const einrichtungOffen = (db: Db): boolean =>
  db.select({ nutzerId: mitglieder.nutzerId }).from(mitglieder).limit(1).get() === undefined;

export type Einrichtungscode = { code: string; gueltigBis: number };

/**
 * A new setup code while the setup is open, else nothing. Codes of earlier starts are removed: only
 * the one just written to the log is valid.
 */
export const einrichtungscodeErzeugen = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: number,
  neueId: () => string = randomUUID,
): Einrichtungscode | undefined => {
  if (!einrichtungOffen(db)) return undefined;
  const alte = db.select().from(tokens).where(eq(tokens.zweck, EINRICHTUNG_ZWECK)).all();
  for (const alt of alte)
    schreiben(
      schreibDb,
      { betreiberId: alt.betreiberId, akteur: "system", jetzt, grund: "Neuer Einrichtungscode" },
      "einrichtungscode.ersetzen",
      (s) => s.loeschen("tokens", { tokenId: alt.tokenId }),
    );
  const betreiberId = neueId();
  const gueltigBis = jetzt + EINRICHTUNG_GUELTIG_MS;
  const code = schreiben(
    schreibDb,
    { betreiberId, akteur: "system", jetzt, grund: "Start ohne Inhaber" },
    "einrichtungscode.anlegen",
    (s) =>
      tokenAnlegen(s, {
        betreiberId,
        tokenId: betreiberId,
        zweck: EINRICHTUNG_ZWECK,
        gueltigBis,
        jetzt,
      }),
  );
  return { code, gueltigBis };
};

export type Einloesung =
  | { ok: true; betreiberId: string }
  | { ok: false; grund: "ungueltig" | "abgeschlossen" };

/**
 * Uses up a setup code: valid, unused and while the setup is open, it is removed and the operator id
 * it reserved is returned. The removal is the claim: of two requests with the same code one wins.
 */
export const einrichtungscodeEinloesen = (
  db: Db,
  schreibDb: SchreibDb,
  code: string,
  jetzt: number,
): Einloesung => {
  if (!einrichtungOffen(db)) return { ok: false, grund: "abgeschlossen" };
  const gefunden = tokenFinden(db, code, EINRICHTUNG_ZWECK, jetzt);
  if (!gefunden) return { ok: false, grund: "ungueltig" };
  try {
    schreiben(
      schreibDb,
      {
        betreiberId: gefunden.betreiberId,
        akteur: "einrichtungscode",
        jetzt,
        grund: "Erster Inhaber",
      },
      "einrichtungscode.einloesen",
      (s) => s.loeschen("tokens", { tokenId: gefunden.tokenId }),
    );
  } catch {
    return { ok: false, grund: "ungueltig" };
  }
  return { ok: true, betreiberId: gefunden.betreiberId };
};

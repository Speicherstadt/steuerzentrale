import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { einladungen } from "../../db/schema.ts";
import { type Kontext, type Schreiber, schreiben } from "../audit/index.ts";
import { tokenAnlegen, tokenFinden } from "../geheim/index.ts";

/*
 * Invitations by link (docs/anmeldung.md): the link carries a token of 32 random bytes, stored only
 * as its hash in `tokens` under the invitation's id, valid for seven days and once.
 */
export const EINLADUNG_ZWECK = "einladung";
export const EINLADUNG_GUELTIG_MS = 7 * 24 * 60 * 60 * 1000;

export type Einladung = typeof einladungen.$inferSelect;

export const einladungErstellen = (
  schreibDb: SchreibDb,
  kontext: Kontext,
  rolle: string,
  neueId: () => string = randomUUID,
): { einladung: Einladung; token: string } => {
  const einladungId = neueId();
  const gueltigBis = kontext.jetzt + EINLADUNG_GUELTIG_MS;
  return schreiben(schreibDb, kontext, "einladung.anlegen", (s) => {
    const einladung = s.einfuegen("einladungen", {
      betreiberId: kontext.betreiberId,
      einladungId,
      rolle,
      gueltigBis,
      angelegtVon: kontext.akteur,
      angelegtAm: kontext.jetzt,
    });
    const token = tokenAnlegen(s, {
      betreiberId: kontext.betreiberId,
      tokenId: einladungId,
      zweck: EINLADUNG_ZWECK,
      gueltigBis,
      jetzt: kontext.jetzt,
    });
    return { einladung, token };
  });
};

/** The invitations of an operator not yet accepted, expired ones included */
export const offeneEinladungen = (db: Db, betreiberId: string): Einladung[] =>
  db
    .select()
    .from(einladungen)
    .where(and(eq(einladungen.betreiberId, betreiberId), isNull(einladungen.angenommenAm)))
    .orderBy(einladungen.angelegtAm)
    .all();

/** The invitation a link's token stands for, while it is valid and not used */
export const einladungFinden = (db: Db, token: string, jetzt: number): Einladung | undefined => {
  const gefunden = tokenFinden(db, token, EINLADUNG_ZWECK, jetzt);
  if (!gefunden) return undefined;
  return db
    .select()
    .from(einladungen)
    .where(
      and(
        eq(einladungen.betreiberId, gefunden.betreiberId),
        eq(einladungen.einladungId, gefunden.tokenId),
        isNull(einladungen.angenommenAm),
      ),
    )
    .get();
};

/**
 * Uses up an invitation's token before the account is made: of two requests with the same link one
 * wins. False when it was used or withdrawn meanwhile.
 */
export const einladungEinloesen = (schreibDb: SchreibDb, kontext: Kontext, einladungId: string) => {
  try {
    schreiben(schreibDb, kontext, "einladung.einloesen", (s) =>
      s.loeschen("tokens", { tokenId: einladungId }),
    );
    return true;
  } catch {
    return false;
  }
};

/** Records who accepted the invitation, in the transaction that makes the membership */
export const einladungAngenommen = (
  s: Schreiber,
  einladungId: string,
  nutzerId: string,
  jetzt: number,
) => s.aendern("einladungen", { einladungId }, { angenommenVon: nutzerId, angenommenAm: jetzt });

/** Removes an open invitation and its token, within the writer's transaction */
const offeneEntfernen = (s: Schreiber, einladungId: string) => {
  if (s.vorhanden("tokens", { tokenId: einladungId }))
    s.loeschen("tokens", { tokenId: einladungId });
  s.loeschen("einladungen", { einladungId });
};

/**
 * Withdraws the open invitations a member made, when the member is removed or loses the right to
 * invite: a link kept back would otherwise let them in again with a new account, in its role
 */
export const einladungenVonZurueckziehen = (
  db: Db,
  s: Schreiber,
  mitglied: { betreiberId: string; nutzerId: string },
) => {
  for (const einladung of offeneEinladungen(db, mitglied.betreiberId))
    if (einladung.angelegtVon === mitglied.nutzerId) offeneEntfernen(s, einladung.einladungId);
};

/** Withdraws an open invitation with its token; an accepted one stays as a record */
export const einladungZurueckziehen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  einladungId: string,
): boolean => {
  const offen = offeneEinladungen(db, kontext.betreiberId).some(
    (einladung) => einladung.einladungId === einladungId,
  );
  if (!offen) return false;
  schreiben(schreibDb, kontext, "einladung.zurueckziehen", (s) => offeneEntfernen(s, einladungId));
  return true;
};

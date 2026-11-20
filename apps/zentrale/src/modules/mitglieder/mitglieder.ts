import { and, eq } from "drizzle-orm";
import { darf } from "../../auth/rollen.ts";
import { user } from "../../db/auth-schema.ts";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { betreiber, mitglieder } from "../../db/schema.ts";
import { type Kontext, type Schreiber, schreiben } from "../audit/index.ts";
import { einladungenVonZurueckziehen } from "./einladungen.ts";

/*
 * Operators and their members as the Zentrale keeps them: the operator row and the mirror of Better
 * Auth's memberships, both written through `schreiben`; Better Auth's own rows follow in
 * src/auth/auth.ts. The role of a request is read from here (src/routes/zugang.ts).
 */

export type Mitglied = { betreiberId: string; nutzerId: string; rolle: string };

export const betreiberLesen = (db: Db, betreiberId: string) =>
  db.select().from(betreiber).where(eq(betreiber.betreiberId, betreiberId)).get();

export const betreiberAnlegen = (s: Schreiber, betreiberId: string, name: string, jetzt: number) =>
  s.einfuegen("betreiber", { betreiberId, name, angelegtAm: jetzt });

export const mitgliedEintragen = (s: Schreiber, mitglied: Mitglied, jetzt: number) =>
  s.einfuegen("mitglieder", { ...mitglied, angelegtAm: jetzt });

export const mitgliedVon = (db: Db, betreiberId: string, nutzerId: string): Mitglied | undefined =>
  db
    .select({
      betreiberId: mitglieder.betreiberId,
      nutzerId: mitglieder.nutzerId,
      rolle: mitglieder.rolle,
    })
    .from(mitglieder)
    .where(and(eq(mitglieder.betreiberId, betreiberId), eq(mitglieder.nutzerId, nutzerId)))
    .get();

/** The operators a person is a member of */
export const mitgliedschaftenVon = (db: Db, nutzerId: string): string[] =>
  db
    .select({ betreiberId: mitglieder.betreiberId })
    .from(mitglieder)
    .where(eq(mitglieder.nutzerId, nutzerId))
    .all()
    .map((zeile) => zeile.betreiberId);

/** The members of one operator with name and e-mail address from their accounts */
export const mitgliederListe = (db: Db, betreiberId: string) =>
  db
    .select({
      nutzerId: mitglieder.nutzerId,
      name: user.name,
      email: user.email,
      rolle: mitglieder.rolle,
      angelegtAm: mitglieder.angelegtAm,
    })
    .from(mitglieder)
    .innerJoin(user, eq(user.id, mitglieder.nutzerId))
    .where(eq(mitglieder.betreiberId, betreiberId))
    .orderBy(mitglieder.angelegtAm, user.name)
    .all();

export type Aenderung = { ok: true } | { ok: false; grund: "kein_mitglied" | "letzter_inhaber" };

const inhaberZahl = (db: Db, betreiberId: string): number =>
  db
    .select({ nutzerId: mitglieder.nutzerId })
    .from(mitglieder)
    .where(and(eq(mitglieder.betreiberId, betreiberId), eq(mitglieder.rolle, "inhaber")))
    .all().length;

/** An operator always keeps an owner: the last one can neither lose the role nor leave */
const pruefen = (db: Db, kontext: Kontext, nutzerId: string, bleibtInhaber: boolean) => {
  const mitglied = mitgliedVon(db, kontext.betreiberId, nutzerId);
  if (!mitglied) return { ok: false, grund: "kein_mitglied" } as const;
  if (mitglied.rolle === "inhaber" && !bleibtInhaber && inhaberZahl(db, kontext.betreiberId) <= 1)
    return { ok: false, grund: "letzter_inhaber" } as const;
  return { ok: true } as const;
};

export const rolleAendern = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  nutzerId: string,
  rolle: string,
): Aenderung => {
  const geprueft = pruefen(db, kontext, nutzerId, rolle === "inhaber");
  if (!geprueft.ok) return geprueft;
  schreiben(schreibDb, kontext, "mitglied.rolle", (s) => {
    s.aendern("mitglieder", { nutzerId }, { rolle });
    if (!darf(rolle, "mitglieder:einladen"))
      einladungenVonZurueckziehen(db, s, { betreiberId: kontext.betreiberId, nutzerId });
  });
  return geprueft;
};

export const mitgliedEntfernen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  nutzerId: string,
): Aenderung => {
  const geprueft = pruefen(db, kontext, nutzerId, false);
  if (!geprueft.ok) return geprueft;
  schreiben(schreibDb, kontext, "mitglied.entfernen", (s) => {
    s.loeschen("mitglieder", { nutzerId });
    einladungenVonZurueckziehen(db, s, { betreiberId: kontext.betreiberId, nutzerId });
  });
  return geprueft;
};

import { randomUUID } from "node:crypto";
import { tagesbeginn } from "@steuerzentrale/planung";
import { and, eq, ne } from "drizzle-orm";
import { user } from "../../db/auth-schema.ts";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { betreiber, installationen, kunden } from "../../db/schema.ts";
import { type Kontext, type Schreiber, schreiben } from "../audit/index.ts";
import { kuerzelFuerNeu } from "../kunden/kuerzel.ts";

/*
 * The operator's Betriebsart (BAULISTE.md Z-805; docs/plan.md, "Betriebsart (Z-805)"): `selbst`
 * ("Nur für mich") or `kunden` ("Für Kunden"), null until the first owner answered. In `selbst`
 * one fixed internal customer of the operator owns every installation; the data model stays the
 * same, so switching back and forth loses nothing. Only the owner switches (src/routes/zugang.ts).
 */

export const BETRIEBSARTEN = ["selbst", "kunden"] as const;
export type Betriebsart = (typeof BETRIEBSARTEN)[number];

export type BetriebsartStand = { betriebsart: Betriebsart | null; eigenerKundeId: string | null };

export const betriebsartLesen = (db: Db, betreiberId: string): BetriebsartStand => {
  const zeile = db
    .select({ betriebsart: betreiber.betriebsart, eigenerKundeId: betreiber.eigenerKundeId })
    .from(betreiber)
    .where(eq(betreiber.betreiberId, betreiberId))
    .get();
  return { betriebsart: zeile?.betriebsart ?? null, eigenerKundeId: zeile?.eigenerKundeId ?? null };
};

/** Whether the operator runs only for itself: the endpoints for customers answer `409 betriebsart` */
export const nurFuerMich = (db: Db, betreiberId: string): boolean =>
  betriebsartLesen(db, betreiberId).betriebsart === "selbst";

/** Whether an installation not removed belongs to a customer other than `eigener` */
const fremdeInstallationen = (db: Db, betreiberId: string, eigener: string | null): boolean =>
  db
    .select({ id: installationen.installationId })
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, betreiberId),
        ne(installationen.zustand, "entfernt"),
        ...(eigener === null ? [] : [ne(installationen.kundeId, eigener)]),
      ),
    )
    .get() !== undefined;

/** The internal customer still there, or undefined (none made yet) */
const vorhandenerKunde = (db: Db, betreiberId: string, kundeId: string | null) =>
  kundeId === null
    ? undefined
    : db
        .select({ id: kunden.kundeId })
        .from(kunden)
        .where(and(eq(kunden.betreiberId, betreiberId), eq(kunden.kundeId, kundeId)))
        .get()?.id;

/** Makes the fixed internal customer: named after the operator, the owner as contact */
const eigenenKundenAnlegen = (db: Db, s: Schreiber, kontext: Kontext): string => {
  const { betreiberId, jetzt } = kontext;
  const name = db
    .select({ name: betreiber.name })
    .from(betreiber)
    .where(eq(betreiber.betreiberId, betreiberId))
    .get()?.name;
  const konto = db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, kontext.akteur))
    .get();
  const kundeId = randomUUID();
  const kundenName = name || "Eigene Apps";
  s.einfuegen("kunden", {
    betreiberId,
    kundeId,
    name: kundenName,
    kontaktName: konto?.name || kundenName,
    kontaktEmail: konto?.email ?? "",
    kontaktTelefon: null,
    notiz: null,
    kuerzel: kuerzelFuerNeu(db, betreiberId, kundenName),
    intern: true,
    angelegtAm: jetzt,
  });
  s.einfuegen("vertraege", {
    betreiberId,
    vertragId: randomUUID(),
    kundeId,
    sla: "basis",
    beginn: tagesbeginn(jetzt),
    ende: null,
    angelegtAm: jetzt,
  });
  return kundeId;
};

export type Gesetzt =
  | { ok: true; stand: BetriebsartStand }
  | { ok: false; grund: "fremde_installationen" };

/**
 * Sets the Betriebsart. `selbst` reuses the internal customer or makes it, and is refused while an
 * installation not removed belongs to another customer; `kunden` changes nothing else. Unchanged,
 * no audit entry
 */
export const betriebsartSetzen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  art: Betriebsart,
): Gesetzt => {
  const { betreiberId } = kontext;
  const alt = betriebsartLesen(db, betreiberId);
  const vorhanden = vorhandenerKunde(db, betreiberId, alt.eigenerKundeId) ?? null;
  if (art === "selbst" && fremdeInstallationen(db, betreiberId, vorhanden))
    return { ok: false, grund: "fremde_installationen" };
  if (alt.betriebsart !== art || (art === "selbst" && vorhanden === null))
    schreiben(schreibDb, kontext, `betriebsart.${art}`, (s) => {
      const eigenerKundeId =
        art === "selbst" && vorhanden === null ? eigenenKundenAnlegen(db, s, kontext) : vorhanden;
      s.aendern("betreiber", {}, { betriebsart: art, eigenerKundeId });
    });
  return { ok: true, stand: betriebsartLesen(db, betreiberId) };
};

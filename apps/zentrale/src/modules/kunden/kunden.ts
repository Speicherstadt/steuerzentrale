import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { kunden, type SLAS, vertraege } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";

/*
 * Customers and their contracts (BAULISTE.md Z-801). Reads go through the read-only `db`, always
 * within one operator; every write goes through `schreiben` with the caller's reason. A customer
 * and its one contract are made together; the notice date is the contract's end.
 */

export type Sla = (typeof SLAS)[number];

export type Kunde = {
  id: string;
  name: string;
  kontakt: { name: string; email: string; telefon: string | null };
  notiz: string | null;
  angelegtAm: number;
  vertrag: { sla: Sla; beginn: number; ende: number | null };
};

/** What a person enters about a customer; an optional field left out is empty */
export type Stammdaten = {
  name: string;
  kontakt: { name: string; email: string; telefon?: string | undefined };
  notiz?: string | undefined;
};

export type Ergebnis =
  | { ok: true; kunde: Kunde }
  | { ok: false; grund: "kein_kunde" | "ende_vor_beginn" };

const SPALTEN = {
  id: kunden.kundeId,
  name: kunden.name,
  kontaktName: kunden.kontaktName,
  kontaktEmail: kunden.kontaktEmail,
  kontaktTelefon: kunden.kontaktTelefon,
  notiz: kunden.notiz,
  angelegtAm: kunden.angelegtAm,
  vertragId: vertraege.vertragId,
  sla: vertraege.sla,
  beginn: vertraege.beginn,
  ende: vertraege.ende,
};

const abfrage = (db: Db) =>
  db
    .select(SPALTEN)
    .from(kunden)
    .innerJoin(
      vertraege,
      and(eq(vertraege.betreiberId, kunden.betreiberId), eq(vertraege.kundeId, kunden.kundeId)),
    );

type Zeile = Awaited<ReturnType<ReturnType<typeof abfrage>["all"]>>[number];

const alsKunde = (z: Zeile): Kunde => ({
  id: z.id,
  name: z.name,
  kontakt: { name: z.kontaktName, email: z.kontaktEmail, telefon: z.kontaktTelefon },
  notiz: z.notiz,
  angelegtAm: z.angelegtAm,
  vertrag: { sla: z.sla, beginn: z.beginn, ende: z.ende },
});

const zeileVon = (db: Db, betreiberId: string, kundeId: string): Zeile | undefined =>
  abfrage(db)
    .where(and(eq(kunden.betreiberId, betreiberId), eq(kunden.kundeId, kundeId)))
    .get();

/** The operator's customers by name */
export const kundenListe = (db: Db, betreiberId: string): Kunde[] =>
  abfrage(db)
    .where(eq(kunden.betreiberId, betreiberId))
    .all()
    .map(alsKunde)
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

export const kundeLesen = (db: Db, betreiberId: string, kundeId: string): Kunde | undefined => {
  const zeile = zeileVon(db, betreiberId, kundeId);
  return zeile && alsKunde(zeile);
};

/** The columns of `kunden` a person sets; empty optional fields are stored as null */
const spaltenAus = (daten: Stammdaten) => ({
  name: daten.name,
  kontaktName: daten.kontakt.name,
  kontaktEmail: daten.kontakt.email,
  kontaktTelefon: daten.kontakt.telefon ?? null,
  notiz: daten.notiz ?? null,
});

/** Only the fields whose value differs, so the audit log records what changed */
const unterschied = <T extends Record<string, unknown>>(alt: T, neu: Partial<T>): Partial<T> =>
  Object.fromEntries(
    Object.entries(neu).filter(([feld, wert]) => alt[feld] !== wert),
  ) as Partial<T>;

const gelesen = (db: Db, kontext: Kontext, kundeId: string): Ergebnis => {
  const kunde = kundeLesen(db, kontext.betreiberId, kundeId);
  return kunde ? { ok: true, kunde } : { ok: false, grund: "kein_kunde" };
};

export const kundeAnlegen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  daten: Stammdaten & { vertrag: { sla: Sla; beginn: number } },
): Kunde => {
  const kundeId = randomUUID();
  const { betreiberId, jetzt } = kontext;
  schreiben(schreibDb, kontext, "kunde.anlegen", (s) => {
    s.einfuegen("kunden", { betreiberId, kundeId, ...spaltenAus(daten), angelegtAm: jetzt });
    s.einfuegen("vertraege", {
      betreiberId,
      vertragId: randomUUID(),
      kundeId,
      sla: daten.vertrag.sla,
      beginn: daten.vertrag.beginn,
      ende: null,
      angelegtAm: jetzt,
    });
  });
  return kundeLesen(db, betreiberId, kundeId) as Kunde;
};

/** Replaces what a person entered about the customer and the day its contract begins */
export const kundeAendern = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  kundeId: string,
  daten: Stammdaten & { beginn: number },
): Ergebnis => {
  const alt = zeileVon(db, kontext.betreiberId, kundeId);
  if (!alt) return { ok: false, grund: "kein_kunde" };
  if (alt.ende !== null && alt.ende < daten.beginn) return { ok: false, grund: "ende_vor_beginn" };
  const stamm = unterschied(alt, spaltenAus(daten));
  const vertrag = unterschied(alt, { beginn: daten.beginn });
  if (Object.keys(stamm).length > 0 || Object.keys(vertrag).length > 0)
    schreiben(schreibDb, kontext, "kunde.aendern", (s) => {
      if (Object.keys(stamm).length > 0) s.aendern("kunden", { kundeId }, stamm);
      if (Object.keys(vertrag).length > 0)
        s.aendern("vertraege", { vertragId: alt.vertragId }, vertrag);
    });
  return gelesen(db, kontext, kundeId);
};

/**
 * Sets the day the contract ends (the customer gave notice), or takes it back with `null`; what
 * follows the end (read only, export, deletion after 90 days) comes with later items
 */
export const vertragsendeSetzen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  kundeId: string,
  ende: number | null,
): Ergebnis => {
  const alt = zeileVon(db, kontext.betreiberId, kundeId);
  if (!alt) return { ok: false, grund: "kein_kunde" };
  if (ende !== null && ende < alt.beginn) return { ok: false, grund: "ende_vor_beginn" };
  if (alt.ende !== ende)
    schreiben(
      schreibDb,
      kontext,
      ende === null ? "vertrag.zuruecknehmen" : "vertrag.kuendigen",
      (s) => s.aendern("vertraege", { vertragId: alt.vertragId }, { ende }),
    );
  return gelesen(db, kontext, kundeId);
};

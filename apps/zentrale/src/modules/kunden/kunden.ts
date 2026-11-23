import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { kunden, type SLAS, vertraege } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { kuerzelFuerNeu, kuerzelVergeben, kundenMitFestemKuerzel } from "./kuerzel.ts";

/*
 * Customers and their contracts (BAULISTE.md Z-801). Reads go through the read-only `db`, always
 * within one operator; every write goes through `schreiben` with the caller's reason. A customer
 * and its one contract are made together; the notice date is the contract's end. Its short name
 * (Z-407) is unique within the operator and fixed while an installation of it runs (kuerzel.ts).
 */

export type Sla = (typeof SLAS)[number];

export type Kunde = {
  id: string;
  name: string;
  kontakt: { name: string; email: string; telefon: string | null };
  notiz: string | null;
  kuerzel: string;
  /** False while an installation of the customer runs or is being set up (Z-407) */
  kuerzelAenderbar: boolean;
  /** Our own customer: its installations are the wave "intern", offered pre-releases (Z-501) */
  intern: boolean;
  angelegtAm: number;
  vertrag: { sla: Sla; beginn: number; ende: number | null };
};

/** What a person enters about a customer; an optional field left out is empty */
export type Stammdaten = {
  name: string;
  kontakt: { name: string; email: string; telefon?: string | undefined };
  notiz?: string | undefined;
  /** Left out: a new customer gets one suggested from its name, a changed one keeps its own */
  kuerzel?: string | undefined;
};

export type Ergebnis =
  | { ok: true; kunde: Kunde }
  | { ok: false; grund: "kein_kunde" | "ende_vor_beginn" | "kuerzel_vergeben" | "kuerzel_fest" };

const SPALTEN = {
  id: kunden.kundeId,
  name: kunden.name,
  kontaktName: kunden.kontaktName,
  kontaktEmail: kunden.kontaktEmail,
  kontaktTelefon: kunden.kontaktTelefon,
  notiz: kunden.notiz,
  kuerzel: kunden.kuerzel,
  intern: kunden.intern,
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

const alsKunde =
  (fest: Set<string>) =>
  (z: Zeile): Kunde => ({
    id: z.id,
    name: z.name,
    kontakt: { name: z.kontaktName, email: z.kontaktEmail, telefon: z.kontaktTelefon },
    notiz: z.notiz,
    kuerzel: z.kuerzel,
    kuerzelAenderbar: !fest.has(z.id),
    intern: z.intern,
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
    .map(alsKunde(kundenMitFestemKuerzel(db, betreiberId)))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

export const kundeLesen = (db: Db, betreiberId: string, kundeId: string): Kunde | undefined => {
  const zeile = zeileVon(db, betreiberId, kundeId);
  return zeile && alsKunde(kundenMitFestemKuerzel(db, betreiberId))(zeile);
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
): Ergebnis => {
  const kundeId = randomUUID();
  const { betreiberId, jetzt } = kontext;
  if (daten.kuerzel !== undefined && kuerzelVergeben(db, betreiberId, daten.kuerzel))
    return { ok: false, grund: "kuerzel_vergeben" };
  const kuerzel = daten.kuerzel ?? kuerzelFuerNeu(db, betreiberId, daten.name);
  schreiben(schreibDb, kontext, "kunde.anlegen", (s) => {
    s.einfuegen("kunden", {
      betreiberId,
      kundeId,
      ...spaltenAus(daten),
      kuerzel,
      angelegtAm: jetzt,
    });
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
  return gelesen(db, kontext, kundeId);
};

/** Why the short name cannot become `neu`, if it changes at all */
const kuerzelHindernis = (
  db: Db,
  betreiberId: string,
  alt: { id: string; kuerzel: string },
  neu: string | undefined,
): "kuerzel_vergeben" | "kuerzel_fest" | undefined => {
  if (neu === undefined || neu === alt.kuerzel) return undefined;
  if (kundenMitFestemKuerzel(db, betreiberId).has(alt.id)) return "kuerzel_fest";
  return kuerzelVergeben(db, betreiberId, neu, alt.id) ? "kuerzel_vergeben" : undefined;
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
  const hindernis = kuerzelHindernis(db, kontext.betreiberId, alt, daten.kuerzel);
  if (hindernis) return { ok: false, grund: hindernis };
  const stamm = unterschied(alt, {
    ...spaltenAus(daten),
    ...(daten.kuerzel === undefined ? {} : { kuerzel: daten.kuerzel }),
  });
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

/**
 * Marks the customer as our own or takes the mark back (Z-501; docs/plan.md, "Interne Kunden und
 * Vorabversionen (Z-501)"); the route lets only the owner do it. Unchanged, no audit entry
 */
export const internSetzen = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  kundeId: string,
  intern: boolean,
): Ergebnis => {
  const alt = zeileVon(db, kontext.betreiberId, kundeId);
  if (!alt) return { ok: false, grund: "kein_kunde" };
  if (alt.intern !== intern)
    schreiben(schreibDb, kontext, intern ? "kunde.intern" : "kunde.nicht-intern", (s) =>
      s.aendern("kunden", { kundeId }, { intern }),
    );
  return gelesen(db, kontext, kundeId);
};

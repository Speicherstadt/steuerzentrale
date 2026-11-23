import type { Ruhezeit } from "@steuerzentrale/planung";
import { and, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import {
  benachrichtigungEinstellungen,
  geheimnisse,
  type SMTP_SICHERHEIT,
} from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { geheimnisLesen, geheimnisSetzen } from "../geheim/index.ts";
import type { SmtpZugang } from "./smtp.ts";

/*
 * The operator's mail server and quiet hours (BAULISTE.md Z-703; docs/plan.md, "Benachrichtigungen"):
 * host, port, security, user and sender in `benachrichtigung_einstellungen`, the password as the
 * operator's secret `smtp-passwort` in `geheimnisse`, encrypted, like the DNS token. The API shows
 * of the password only whether it is set; only the delivery reads it (`smtpZugang`).
 */

export const SMTP_PASSWORT = "smtp-passwort";
const PASSWORT_ZWECK = "benachrichtigung:smtp";

export type Sicherheit = (typeof SMTP_SICHERHEIT)[number];

export type SmtpEinstellungen = {
  host: string;
  port: number;
  sicherheit: Sicherheit;
  benutzer: string | null;
  absender: string;
  passwortGesetzt: boolean;
};

export type Benachrichtigungseinstellungen = {
  smtp: SmtpEinstellungen | null;
  ruhezeit: Ruhezeit | null;
};

export type NeueEinstellungen = {
  smtp: {
    host: string;
    port: number;
    sicherheit: Sicherheit;
    benutzer: string | null;
    absender: string;
    /** Left out: the password set before stays (while there is a user) */
    passwort?: string | undefined;
  } | null;
  ruhezeit: Ruhezeit | null;
};

const zeileVon = (db: Db, betreiberId: string) =>
  db
    .select()
    .from(benachrichtigungEinstellungen)
    .where(eq(benachrichtigungEinstellungen.betreiberId, betreiberId))
    .get();

const passwortGesetzt = (db: Db, betreiberId: string): boolean =>
  db
    .select({ id: geheimnisse.geheimnisId })
    .from(geheimnisse)
    .where(
      and(eq(geheimnisse.betreiberId, betreiberId), eq(geheimnisse.geheimnisId, SMTP_PASSWORT)),
    )
    .get() !== undefined;

/** The quiet hours of an operator, or null */
export const ruhezeitVon = (db: Db, betreiberId: string): Ruhezeit | null => {
  const z = zeileVon(db, betreiberId);
  return z?.ruheVon && z.ruheBis ? { von: z.ruheVon, bis: z.ruheBis } : null;
};

export const einstellungenLesen = (db: Db, betreiberId: string): Benachrichtigungseinstellungen => {
  const z = zeileVon(db, betreiberId);
  const smtp =
    z?.smtpHost && z.smtpPort && z.smtpSicherheit && z.absender
      ? {
          host: z.smtpHost,
          port: z.smtpPort,
          sicherheit: z.smtpSicherheit,
          benutzer: z.smtpBenutzer,
          absender: z.absender,
          passwortGesetzt: passwortGesetzt(db, betreiberId),
        }
      : null;
  return { smtp, ruhezeit: ruhezeitVon(db, betreiberId) };
};

/** Sets mail server and quiet hours; the password only when given, gone with the user */
export const einstellungenSetzen = (
  deps: { db: Db; schreibDb: SchreibDb; schluessel: Schluesselbund },
  kontext: Kontext,
  neu: NeueEinstellungen,
): Benachrichtigungseinstellungen => {
  const { betreiberId, jetzt } = kontext;
  const zeile = {
    smtpHost: neu.smtp?.host ?? null,
    smtpPort: neu.smtp?.port ?? null,
    smtpSicherheit: neu.smtp?.sicherheit ?? null,
    smtpBenutzer: neu.smtp?.benutzer ?? null,
    absender: neu.smtp?.absender ?? null,
    ruheVon: neu.ruhezeit?.von ?? null,
    ruheBis: neu.ruhezeit?.bis ?? null,
    geaendertAm: jetzt,
  };
  const mitBenutzer = Boolean(neu.smtp?.benutzer);
  schreiben(deps.schreibDb, kontext, "benachrichtigung.einstellungen", (w) => {
    if (w.vorhanden("benachrichtigungEinstellungen", {}))
      w.aendern("benachrichtigungEinstellungen", {}, zeile);
    else w.einfuegen("benachrichtigungEinstellungen", { betreiberId, ...zeile });
    if (mitBenutzer && neu.smtp?.passwort !== undefined)
      geheimnisSetzen(w, deps.schluessel, {
        betreiberId,
        geheimnisId: SMTP_PASSWORT,
        zweck: PASSWORT_ZWECK,
        klartext: neu.smtp.passwort,
        jetzt,
      });
    if (!mitBenutzer && w.vorhanden("geheimnisse", { geheimnisId: SMTP_PASSWORT }))
      w.loeschen("geheimnisse", { geheimnisId: SMTP_PASSWORT });
  });
  return einstellungenLesen(deps.db, betreiberId);
};

export type Zugang = { ok: true; zugang: SmtpZugang } | { ok: false; fehler: string };

/** Everything a mail needs, the password decrypted, or what is missing */
export const smtpZugang = (db: Db, bund: Schluesselbund, betreiberId: string): Zugang => {
  const e = einstellungenLesen(db, betreiberId).smtp;
  if (!e) return { ok: false, fehler: "no mail server set" };
  const { passwortGesetzt: _, ...ohne } = e;
  if (!e.benutzer) return { ok: true, zugang: { ...ohne, passwort: null } };
  const passwort = geheimnisLesen(db, bund, betreiberId, SMTP_PASSWORT);
  if (!passwort.ok) return { ok: false, fehler: "the mail server's password is missing" };
  return { ok: true, zugang: { ...ohne, passwort: passwort.wert } };
};

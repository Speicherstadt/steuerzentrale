import { randomUUID } from "node:crypto";
import type { SchreibDb } from "../db/oeffnen.ts";
import { schreiben } from "../modules/audit/index.ts";
import {
  einstellungenSetzen,
  empfaengerAnlegen,
  type NeueEinstellungen,
  type NeuerEmpfaenger,
  type Versand,
  zustellungenAnlegen,
  zustellungenSenden,
} from "../modules/benachrichtigung/index.ts";
import { ntfySenden } from "../modules/benachrichtigung/ntfy.ts";
import type { WebhookDeps } from "../modules/benachrichtigung/oeffentlich.ts";
import { mailSenden } from "../modules/benachrichtigung/smtp.ts";
import { webhookSenden } from "../modules/benachrichtigung/webhook.ts";
import { bewertungsUmgebung } from "./bewertung.ts";

/*
 * For the tests of notifications (Z-703): the operators of the rating tests with a clock that the
 * test moves, the real SMTP client, webhook and ntfy sender pointed at stand-ins on localhost (plain SMTP,
 * http, any address: what production refuses, the tests of webhook.ts prove), and one run of the
 * loop as `lauf`.
 */
export const T0 = Date.UTC(2026, 10, 23, 11);

const lokal: WebhookDeps = {
  fetch,
  aufloesen: async () => ["127.0.0.1"],
  adresseErlaubt: () => true,
  nurHttps: false,
  zeitlimitMs: 5000,
};

export const versandImTest = (): Versand => ({
  mail: (zugang, mail) => mailSenden(zugang, mail, { zeitlimitMs: 5000 }),
  webhook: (ziel, nachricht, jetzt) => webhookSenden(lokal, ziel, nachricht, jetzt),
  ntfy: (ziel, nachricht) => ntfySenden(lokal, ziel, nachricht),
});

export const benachrichtigungsUmgebung = (versand: Versand = versandImTest()) => {
  const offen = bewertungsUmgebung();
  const uhr = { ms: T0 };
  const deps = {
    db: offen.db,
    schreibDb: offen.schreibDb,
    schluessel: offen.schluessel,
    versand,
    now: () => uhr.ms,
    url: "https://zentrale.test",
  };
  const kontext = (betreiberId: string) => ({
    betreiberId,
    akteur: "test",
    jetzt: uhr.ms,
    grund: "Test",
  });
  return {
    ...offen,
    uhr,
    deps,
    einstellen: (betreiberId: string, neu: NeueEinstellungen) =>
      einstellungenSetzen(deps, kontext(betreiberId), neu),
    empfaenger: (betreiberId: string, neu: NeuerEmpfaenger) =>
      empfaengerAnlegen(deps, kontext(betreiberId), neu),
    /** One run of the loop at the clock's time */
    lauf: async () => {
      const angelegt = zustellungenAnlegen(offen.db, offen.schreibDb, uhr.ms);
      return { angelegt, ...(await zustellungenSenden(deps)) };
    },
  };
};

/** Mail settings for the stand-in on `port`, without a user */
export const smtpBei = (port: number): NeueEinstellungen["smtp"] => ({
  host: "127.0.0.1",
  port,
  sicherheit: "keine",
  benutzer: null,
  absender: "zentrale@betreiber.test",
});

/** An event straight into the table, as a module of the Zentrale writes one */
export const ereignisSchreiben = (
  schreibDb: SchreibDb,
  betreiberId: string,
  e: { zeitpunkt: number; art: string; schwere: string; ziel?: string; text?: string },
) =>
  schreiben(
    schreibDb,
    { betreiberId, akteur: "system", jetzt: e.zeitpunkt, grund: "Test" },
    "test",
    (w) =>
      w.einfuegen("ereignisse", {
        betreiberId,
        ereignisId: randomUUID(),
        zeitpunkt: e.zeitpunkt,
        art: e.art,
        schwere: e.schwere,
        ziel: e.ziel ?? "server:s1",
        text: e.text ?? `${e.art} auf s1`,
      }),
  );

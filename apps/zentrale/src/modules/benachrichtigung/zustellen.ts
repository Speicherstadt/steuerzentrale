import { zustellbarAb } from "@steuerzentrale/planung";
import { and, asc, eq, lte } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { ereignisse, zustellungen } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { schreiben } from "../audit/index.ts";
import { ruhezeitVon, smtpZugang } from "./einstellungen.ts";
import { type EmpfaengerZeile, empfaengerZeile, webhookZiel } from "./empfaenger.ts";
import { type Ereignis, mailVon, webhookBody } from "./nachricht.ts";
import type { Gesendet, Mail, SmtpZugang } from "./smtp.ts";
import type { WebhookZiel } from "./webhook.ts";

/*
 * The delivery of the outbox (BAULISTE.md Z-703; docs/plan.md, "Benachrichtigungen"): every due
 * delivery of every operator is sent, a fault at once, anything else after the operator's quiet
 * hours; a failure waits 1, 2, 4 … minutes, at most an hour, and after 10 attempts the delivery is
 * given up. Each result goes through `schreiben`, so the audit log shows when an operator was told.
 * The same delivery serves the Portal later (Z-903). A crash between sending and writing sends once
 * more: the receiver knows a repeat by the delivery's id.
 */
export const MAX_VERSUCHE = 10;
const MINUTE = 60_000;

/** How long after the n-th failed attempt the next one waits */
export const wartezeit = (versuche: number): number =>
  Math.min(MINUTE * 2 ** Math.max(0, versuche - 1), 60 * MINUTE);

/** How mail and webhooks go out: the real ones in main.ts, stand-ins in tests */
export type Versand = {
  mail: (zugang: SmtpZugang, mail: Mail) => Promise<Gesendet>;
  webhook: (
    ziel: WebhookZiel,
    nachricht: { zustellungId: string; body: string },
    jetzt: number,
  ) => Promise<Gesendet>;
};

export type ZustellDeps = {
  db: Db;
  schreibDb: SchreibDb;
  schluessel: Schluesselbund;
  versand: Versand;
  now: () => number;
  /** Where the interface is reached (STEUERZENTRALE_URL), for the link in a mail */
  url: string;
};

type Zeile = typeof zustellungen.$inferSelect;

/** Sends one message of `e` to recipient `r` */
export const senden = (
  deps: ZustellDeps,
  r: EmpfaengerZeile,
  e: Ereignis,
  z: Pick<Zeile, "zustellungId" | "schwere">,
  jetzt: number,
): Promise<Gesendet> => {
  if (r.art === "mail") {
    const smtp = smtpZugang(deps.db, deps.schluessel, r.betreiberId);
    if (!smtp.ok) return Promise.resolve(smtp);
    return deps.versand.mail(smtp.zugang, mailVon(e, z, r.anzeige, deps.url));
  }
  const ziel = webhookZiel(deps.schluessel, r);
  if (!ziel) return Promise.resolve({ ok: false, fehler: "the webhook's key does not decrypt" });
  return deps.versand.webhook(
    ziel,
    { zustellungId: z.zustellungId, body: webhookBody(e, z) },
    jetzt,
  );
};

/** Writes an attempt's result; `endgueltig`: no attempt can succeed any more */
const ergebnisSchreiben = (
  schreibDb: SchreibDb,
  z: Zeile,
  g: Gesendet,
  jetzt: number,
  endgueltig = false,
) => {
  const versuche = z.versuche + 1;
  const werte = g.ok
    ? { zustand: "zugestellt" as const, versuche, fehler: null, erledigtAm: jetzt }
    : endgueltig || versuche >= MAX_VERSUCHE
      ? { zustand: "aufgegeben" as const, versuche, fehler: g.fehler, erledigtAm: jetzt }
      : { versuche, fehler: g.fehler, faelligAm: jetzt + wartezeit(versuche) };
  const kontext = {
    betreiberId: z.betreiberId,
    akteur: "system",
    jetzt,
    grund: g.ok ? "zugestellt" : `Zustellung gescheitert: ${g.fehler}`,
  };
  schreiben(schreibDb, kontext, "benachrichtigung.zustellung", (w) =>
    w.aendern("zustellungen", { zustellungId: z.zustellungId }, werte),
  );
};

const ereignisVon = (db: Db, z: Zeile) =>
  db
    .select()
    .from(ereignisse)
    .where(and(eq(ereignisse.betreiberId, z.betreiberId), eq(ereignisse.ereignisId, z.ereignisId)))
    .get();

export type Gesendete = { zugestellt: number; gescheitert: number; gehalten: number };

const BATCH = 100;

/**
 * Sends the due deliveries once, one after another, at most BATCH per run; returns what became of
 * them. Held ones do not count towards BATCH: a night of warnings must not keep a fault, or another
 * operator's message, back
 */
export const zustellungenSenden = async (deps: ZustellDeps): Promise<Gesendete> => {
  const jetzt = deps.now();
  const ergebnis: Gesendete = { zugestellt: 0, gescheitert: 0, gehalten: 0 };
  const faellig = deps.db
    .select()
    .from(zustellungen)
    .where(and(eq(zustellungen.zustand, "wartet"), lte(zustellungen.faelligAm, jetzt)))
    .orderBy(asc(zustellungen.faelligAm), asc(zustellungen.angelegtAm))
    .all();
  for (const z of faellig) {
    if (zustellbarAb(ruhezeitVon(deps.db, z.betreiberId), z.schwere, jetzt) > jetzt) {
      ergebnis.gehalten += 1;
      continue;
    }
    if (ergebnis.zugestellt + ergebnis.gescheitert >= BATCH) break;
    const r = empfaengerZeile(deps.db, z.betreiberId, z.empfaengerId);
    const e = ereignisVon(deps.db, z);
    const g: Gesendet =
      r && e
        ? await senden(deps, r, e, z, deps.now())
        : { ok: false, fehler: "event or recipient gone" };
    ergebnisSchreiben(deps.schreibDb, z, g, deps.now(), !(r && e));
    ergebnis[g.ok ? "zugestellt" : "gescheitert"] += 1;
  }
  return ergebnis;
};

/** A test message to one recipient, now and past the quiet hours; undefined when there is none */
export const testSenden = (
  deps: ZustellDeps,
  betreiberId: string,
  empfaengerId: string,
  jetzt: number,
): Promise<Gesendet> | undefined => {
  const r = empfaengerZeile(deps.db, betreiberId, empfaengerId);
  if (!r) return undefined;
  const e: Ereignis = {
    ereignisId: `test-${jetzt}`,
    zeitpunkt: jetzt,
    art: "test",
    schwere: "info",
    ziel: `empfaenger:${empfaengerId}`,
    text: "Testnachricht der Steuerzentrale",
  };
  return senden(
    deps,
    r,
    e,
    { zustellungId: `${e.ereignisId}.${empfaengerId}`, schwere: "info" },
    jetzt,
  );
};

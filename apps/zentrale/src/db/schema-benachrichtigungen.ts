import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/*
 * Notifications (BAULISTE.md Z-703; docs/plan.md, "Benachrichtigungen"), re-exported by schema.ts;
 * every table carries betreiber_id. The SMTP password lies in `geheimnisse`, a webhook's address and
 * key in the encrypted column `empfaenger.geheim`; nothing here holds a secret in plain text.
 */

export const SMTP_SICHERHEIT = ["tls", "starttls", "keine"] as const;
export const EMPFAENGER_ARTEN = ["mail", "webhook"] as const;
export const SCHWEREN = ["info", "warn", "fehler"] as const;
export const ZUSTELLUNG_ZUSTAENDE = ["wartet", "zugestellt", "aufgegeben"] as const;

/**
 * The operator's mail server and quiet hours, one row per operator; every column may be empty (an
 * operator with webhooks only has no mail server). `sicherheit` `keine` only on the own machine
 */
export const benachrichtigungEinstellungen = sqliteTable("benachrichtigung_einstellungen", {
  betreiberId: text("betreiber_id").primaryKey(),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSicherheit: text("smtp_sicherheit", { enum: SMTP_SICHERHEIT }),
  smtpBenutzer: text("smtp_benutzer"),
  absender: text("absender"),
  ruheVon: text("ruhe_von"),
  ruheBis: text("ruhe_bis"),
  geaendertAm: integer("geaendert_am").notNull(),
});

/**
 * Who is told: a mail address or a webhook, from a severity upwards. `anzeige` is what the API shows
 * (the address, or a webhook's origin only: the path of a chat's hook is its key); `geheim` holds a
 * webhook's URL and signing key as encrypted JSON, empty for mail
 */
export const empfaenger = sqliteTable(
  "empfaenger",
  {
    betreiberId: text("betreiber_id").notNull(),
    empfaengerId: text("empfaenger_id").notNull(),
    art: text("art", { enum: EMPFAENGER_ARTEN }).notNull(),
    anzeige: text("anzeige").notNull(),
    abSchwere: text("ab_schwere", { enum: SCHWEREN }).notNull(),
    geheim: text("geheim"),
    angelegtAm: integer("angelegt_am").notNull(),
  },
  (t) => [primaryKey({ columns: [t.betreiberId, t.empfaengerId] })],
);

/**
 * One message of one event to one recipient: the outbox. `zustellung_id` is
 * `<ereignis_id>.<empfaenger_id>`, so an event reaches a recipient once however often it is looked
 * at, and the receiver of a webhook recognises a repeat by it. `schwere` is the one it goes out
 * with (a fix takes that of what it fixes); kept 30 days
 */
export const zustellungen = sqliteTable(
  "zustellungen",
  {
    betreiberId: text("betreiber_id").notNull(),
    zustellungId: text("zustellung_id").notNull(),
    ereignisId: text("ereignis_id").notNull(),
    empfaengerId: text("empfaenger_id").notNull(),
    schwere: text("schwere", { enum: SCHWEREN }).notNull(),
    zustand: text("zustand", { enum: ZUSTELLUNG_ZUSTAENDE }).notNull(),
    versuche: integer("versuche").notNull(),
    faelligAm: integer("faellig_am").notNull(),
    fehler: text("fehler"),
    angelegtAm: integer("angelegt_am").notNull(),
    erledigtAm: integer("erledigt_am"),
  },
  (t) => [
    primaryKey({ columns: [t.betreiberId, t.zustellungId] }),
    index("zustellungen_faellig").on(t.zustand, t.faelligAm),
    index("zustellungen_angelegt").on(t.betreiberId, t.angelegtAm),
    index("zustellungen_ereignis").on(t.betreiberId, t.ereignisId),
  ],
);

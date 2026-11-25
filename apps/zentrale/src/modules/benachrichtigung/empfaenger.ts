import { randomUUID } from "node:crypto";
import type { Schwere } from "@steuerzentrale/planung";
import { and, asc, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { empfaenger, zustellungen } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { spalteEntschluesseln, spalteVerschluesseln } from "../geheim/spalten.ts";
import type { NtfyZiel } from "./ntfy.ts";
import type { WebhookZiel } from "./webhook.ts";

/*
 * The operator's recipients (BAULISTE.md Z-703): a mail address or a webhook, each from a severity
 * upwards. A webhook's URL and signing key are encrypted together in `geheim`, bound to operator and
 * recipient; the API shows only the URL's origin, since a chat's hook carries its key in the path,
 * and never the key: the operator enters it (the interface offers one made in the browser, shown
 * once before saving) and keeps it for the receiver. Removing a recipient ends its waiting
 * deliveries. A ntfy topic (Z-1105) likewise: its address and access token encrypted in `geheim`,
 * the API shows the server's origin only, since on a public server the topic's name is its key.
 */

export type Empfaenger = {
  empfaengerId: string;
  art: "mail" | "webhook" | "ntfy";
  anzeige: string;
  abSchwere: Schwere;
  angelegtAm: number;
};

export type NeuerEmpfaenger =
  | { art: "mail"; adresse: string; abSchwere: Schwere }
  | { art: "webhook"; url: string; schluessel: string; abSchwere: Schwere }
  | { art: "ntfy"; url: string; token: string | null; abSchwere: Schwere };

export type EmpfaengerZeile = typeof empfaenger.$inferSelect;

const oeffentlich = (z: EmpfaengerZeile): Empfaenger => ({
  empfaengerId: z.empfaengerId,
  art: z.art,
  anzeige: z.anzeige,
  abSchwere: z.abSchwere,
  angelegtAm: z.angelegtAm,
});

export const empfaengerLesen = (db: Db, betreiberId: string): Empfaenger[] =>
  db
    .select()
    .from(empfaenger)
    .where(eq(empfaenger.betreiberId, betreiberId))
    .orderBy(asc(empfaenger.angelegtAm), asc(empfaenger.empfaengerId))
    .all()
    .map(oeffentlich);

export const empfaengerZeile = (
  db: Db,
  betreiberId: string,
  empfaengerId: string,
): EmpfaengerZeile | undefined =>
  db
    .select()
    .from(empfaenger)
    .where(and(eq(empfaenger.betreiberId, betreiberId), eq(empfaenger.empfaengerId, empfaengerId)))
    .get();

export const empfaengerAnlegen = (
  deps: { schreibDb: SchreibDb; schluessel: Schluesselbund },
  kontext: Kontext,
  neu: NeuerEmpfaenger,
  empfaengerId: string = randomUUID(),
): Empfaenger => {
  const { betreiberId, jetzt } = kontext;
  const klar =
    neu.art === "webhook"
      ? { url: neu.url, schluessel: neu.schluessel }
      : neu.art === "ntfy"
        ? { url: neu.url, token: neu.token }
        : null;
  const geheim =
    klar === null
      ? null
      : spalteVerschluesseln(
          deps.schluessel,
          "empfaenger",
          betreiberId,
          { empfaengerId },
          JSON.stringify(klar),
        );
  const zeile = schreiben(deps.schreibDb, kontext, "benachrichtigung.empfaenger-anlegen", (w) =>
    w.einfuegen("empfaenger", {
      betreiberId,
      empfaengerId,
      art: neu.art,
      anzeige: neu.art === "mail" ? neu.adresse : new URL(neu.url).origin,
      abSchwere: neu.abSchwere,
      geheim,
      angelegtAm: jetzt,
    }),
  );
  return oeffentlich(zeile);
};

/** Removes the operator's recipient and ends its waiting deliveries; false when there is none */
export const empfaengerEntfernen = (
  deps: { db: Db; schreibDb: SchreibDb },
  kontext: Kontext,
  empfaengerId: string,
): boolean => {
  if (!empfaengerZeile(deps.db, kontext.betreiberId, empfaengerId)) return false;
  const wartend = deps.db
    .select({ id: zustellungen.zustellungId })
    .from(zustellungen)
    .where(
      and(
        eq(zustellungen.betreiberId, kontext.betreiberId),
        eq(zustellungen.empfaengerId, empfaengerId),
        eq(zustellungen.zustand, "wartet"),
      ),
    )
    .all();
  schreiben(deps.schreibDb, kontext, "benachrichtigung.empfaenger-entfernen", (w) => {
    w.loeschen("empfaenger", { empfaengerId });
    for (const z of wartend)
      w.aendern(
        "zustellungen",
        { zustellungId: z.id },
        { zustand: "aufgegeben", fehler: "recipient removed", erledigtAm: kontext.jetzt },
      );
  });
  return true;
};

/** A webhook's URL and key, decrypted, for the delivery only; undefined for mail or if unreadable */
export const webhookZiel = (bund: Schluesselbund, z: EmpfaengerZeile): WebhookZiel | undefined => {
  if (z.art !== "webhook" || !z.geheim) return undefined;
  const klar = spalteEntschluesseln(
    bund,
    "empfaenger",
    z.betreiberId,
    { empfaengerId: z.empfaengerId },
    z.geheim,
  );
  return klar.ok ? (JSON.parse(klar.wert) as WebhookZiel) : undefined;
};

/** A ntfy topic's address and token, decrypted, for the delivery only; undefined if unreadable */
export const ntfyZiel = (bund: Schluesselbund, z: EmpfaengerZeile): NtfyZiel | undefined => {
  if (z.art !== "ntfy" || !z.geheim) return undefined;
  const klar = spalteEntschluesseln(
    bund,
    "empfaenger",
    z.betreiberId,
    { empfaengerId: z.empfaengerId },
    z.geheim,
  );
  return klar.ok ? (JSON.parse(klar.wert) as NtfyZiel) : undefined;
};

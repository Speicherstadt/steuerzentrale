import { lookup } from "node:dns/promises";
import type { Planer } from "../aufbewahrung/index.ts";
import { istOeffentlicheAdresse } from "../dns/plan.ts";
import { ntfySenden } from "./ntfy.ts";
import type { WebhookDeps } from "./oeffentlich.ts";
import { mailSenden, type SmtpOptionen } from "./smtp.ts";
import { webhookSenden } from "./webhook.ts";
import { zustellungenAnlegen } from "./zuordnen.ts";
import { type Versand, type ZustellDeps, zustellungenSenden } from "./zustellen.ts";

/*
 * The notifications' loop (BAULISTE.md Z-703): every 15 seconds the new events become deliveries
 * and the due ones are sent; a run that is still sending is not started twice. `anstossen` runs it
 * at once, as the DNS and backup loops do.
 */
export const BENACHRICHTIGUNG_MS = 15_000;
const ZEITLIMIT_MS = 15_000;

/** The real way out: SMTP with the system's trust, webhooks and ntfy to public https addresses only */
export const versandImBetrieb = (f: typeof fetch, smtp: Partial<SmtpOptionen> = {}): Versand => {
  const oeffentlich: WebhookDeps = {
    fetch: f,
    aufloesen: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
    adresseErlaubt: istOeffentlicheAdresse,
    nurHttps: true,
    zeitlimitMs: ZEITLIMIT_MS,
  };
  return {
    mail: (zugang, mail) => mailSenden(zugang, mail, { zeitlimitMs: ZEITLIMIT_MS, ...smtp }),
    webhook: (ziel, nachricht, jetzt) => webhookSenden(oeffentlich, ziel, nachricht, jetzt),
    ntfy: (ziel, nachricht) => ntfySenden(oeffentlich, ziel, nachricht),
  };
};

export const benachrichtigungsSchleife = (
  deps: ZustellDeps & { log: (zeile: string) => void },
  planen: Planer,
): { anstossen: () => void } => {
  let laeuft = false;
  const lauf = async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      const angelegt = zustellungenAnlegen(deps.db, deps.schreibDb, deps.now());
      const gesendet = await zustellungenSenden(deps);
      if (angelegt + gesendet.zugestellt + gesendet.gescheitert > 0)
        deps.log(JSON.stringify({ msg: "notifications", angelegt, ...gesendet }));
    } catch (fehler) {
      deps.log(JSON.stringify({ msg: "notifications failed", fehler: String(fehler) }));
    } finally {
      laeuft = false;
    }
  };
  planen(() => void lauf(), BENACHRICHTIGUNG_MS);
  return { anstossen: () => void lauf() };
};

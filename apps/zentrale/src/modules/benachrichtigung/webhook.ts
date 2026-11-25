import { oeffentlichPosten, type WebhookDeps } from "./oeffentlich.ts";
import { SIGNATUR_HEADER, signieren, ZUSTELLUNG_HEADER } from "./signatur.ts";
import type { Gesendet } from "./smtp.ts";

export type { Aufloesen, WebhookDeps } from "./oeffentlich.ts";

/*
 * Sending a webhook (BAULISTE.md Z-703; docs/benachrichtigungen.md): a POST of JSON, signed with
 * the recipient's key, with the delivery's id as idempotency key, to a public address only
 * (oeffentlich.ts).
 */

export type WebhookZiel = { url: string; schluessel: string };

/** Posts `body` signed at `jetzt`; never throws, a failure comes back as a value */
export const webhookSenden = (
  deps: WebhookDeps,
  ziel: WebhookZiel,
  nachricht: { zustellungId: string; body: string },
  jetzt: number,
): Promise<Gesendet> =>
  oeffentlichPosten(
    deps,
    "webhook",
    new URL(ziel.url),
    {
      "content-type": "application/json",
      [SIGNATUR_HEADER]: signieren(ziel.schluessel, jetzt, nachricht.body),
      [ZUSTELLUNG_HEADER]: nachricht.zustellungId,
    },
    nachricht.body,
  );

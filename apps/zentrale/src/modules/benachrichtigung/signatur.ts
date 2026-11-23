import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The signature of a webhook (BAULISTE.md Z-703; docs/benachrichtigungen.md): the header
 * `X-Steuerzentrale-Signatur: t=<ms>,v1=<hex>`, where v1 is the HMAC-SHA256 with the recipient's
 * key over "<t>.<body>" (the raw bytes of the body as sent). The time binds the signature to the
 * moment, so a recorded request cannot be replayed after five minutes; the same function checks it
 * in the tests' receiver and, later, in the Portal (Z-903).
 */
export const SIGNATUR_HEADER = "x-steuerzentrale-signatur";
/** The id of a delivery: the same on every attempt, so a receiver recognises a repeat */
export const ZUSTELLUNG_HEADER = "x-steuerzentrale-zustellung";
export const SIGNATUR_TOLERANZ_MS = 5 * 60_000;

const hmac = (schluessel: string, zeitpunkt: number, body: string): string =>
  createHmac("sha256", schluessel).update(`${zeitpunkt}.${body}`).digest("hex");

/** The header's value for `body`, sent at `zeitpunkt` */
export const signieren = (schluessel: string, zeitpunkt: number, body: string): string =>
  `t=${zeitpunkt},v1=${hmac(schluessel, zeitpunkt, body)}`;

export type Geprueft = { ok: true } | { ok: false; grund: "form" | "zeit" | "falsch" };

const FORM = /^t=(\d{1,16}),v1=([0-9a-f]{64})$/;

/** Whether the header holds for `body` and was made within five minutes of `jetzt` */
export const signaturPruefen = (
  schluessel: string,
  header: string | null | undefined,
  body: string,
  jetzt: number,
  toleranzMs = SIGNATUR_TOLERANZ_MS,
): Geprueft => {
  const teile = FORM.exec(header ?? "");
  if (!teile) return { ok: false, grund: "form" };
  const zeitpunkt = Number(teile[1]);
  if (Math.abs(jetzt - zeitpunkt) > toleranzMs) return { ok: false, grund: "zeit" };
  const erwartet = Buffer.from(hmac(schluessel, zeitpunkt, body), "hex");
  const erhalten = Buffer.from(teile[2] ?? "", "hex");
  return timingSafeEqual(erwartet, erhalten) ? { ok: true } : { ok: false, grund: "falsch" };
};

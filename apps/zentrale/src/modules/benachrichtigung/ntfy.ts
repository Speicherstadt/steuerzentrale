import type { Schwere } from "@steuerzentrale/planung";
import type { Ereignis, Zustellung } from "./nachricht.ts";
import { oeffentlichPosten, type WebhookDeps } from "./oeffentlich.ts";
import type { Gesendet } from "./smtp.ts";
import { behobeneArt } from "./zuordnen.ts";

/*
 * A message to the phone by ntfy (BAULISTE.md Z-1105; docs/benachrichtigungen.md): published as JSON
 * to the root of the ntfy server (ntfy docs, "Publishing", "Publish as JSON": `topic`, `title`,
 * `message`, `priority`, `tags`), which carries the German titles that a header would not. The
 * operator enters the topic's address (`https://ntfy.sh/<topic>`, a server of their own with a path
 * before the topic too) and, for a protected topic, an access token, sent as bearer token. The
 * address is reached as a webhook's is: public addresses only, no redirect (oeffentlich.ts).
 */

export type NtfyZiel = { url: string; token: string | null };

export type NtfyNachricht = { title: string; message: string; priority: number; tags: string[] };

// ntfy's topic names: letters, digits, `_` and `-`, at most 64
const THEMA = /^[A-Za-z0-9_-]{1,64}$/;

/** The server's root and the topic of a topic's address, or undefined for any other address */
export const ntfyThema = (text: string): { basis: string; topic: string } | undefined => {
  if (!URL.canParse(text)) return undefined;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  const teile = url.pathname.split("/");
  const topic = teile.pop() ?? "";
  if (!THEMA.test(topic)) return undefined;
  return { basis: `${url.origin}${teile.join("/")}/`, topic };
};

// ntfy's priorities: 5 max (a long vibration, through "do not disturb" on Android), 3 default
const PRIORITAET: Record<Schwere, number> = { fehler: 5, warn: 4, info: 3 };
const TITEL: Record<Schwere, string> = { fehler: "Störung", warn: "Warnung", info: "Hinweis" };
const TAG: Record<Schwere, string> = {
  fehler: "rotating_light",
  warn: "warning",
  info: "information_source",
};

/** Title, text, priority and emoji tag of one event; a fix goes out calm, as "Behoben" */
export const ntfyNachricht = (e: Ereignis, z: Zustellung): NtfyNachricht =>
  behobeneArt(e.art) === undefined
    ? {
        title: TITEL[z.schwere],
        message: e.text,
        priority: PRIORITAET[z.schwere],
        tags: [TAG[z.schwere]],
      }
    : { title: "Behoben", message: e.text, priority: 3, tags: ["white_check_mark"] };

/** Publishes `n` to the topic; never throws, a failure comes back as a value */
export const ntfySenden = (
  deps: WebhookDeps,
  ziel: NtfyZiel,
  n: NtfyNachricht,
): Promise<Gesendet> => {
  const thema = ntfyThema(ziel.url);
  if (!thema) return Promise.resolve({ ok: false, fehler: "ntfy: not a topic's address" });
  return oeffentlichPosten(
    deps,
    "ntfy",
    new URL(thema.basis),
    {
      "content-type": "application/json",
      ...(ziel.token ? { authorization: `Bearer ${ziel.token}` } : {}),
    },
    JSON.stringify({ topic: thema.topic, ...n }),
  );
};

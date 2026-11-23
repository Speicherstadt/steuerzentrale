import type { Schwere } from "@steuerzentrale/planung";
import { ZEITZONE } from "@steuerzentrale/planung";
import type { ereignisse } from "../../db/schema.ts";
import type { Mail } from "./smtp.ts";
import { behobeneArt } from "./zuordnen.ts";

/*
 * What a delivery says (BAULISTE.md Z-703; docs/benachrichtigungen.md): a mail in German with the
 * event's text in the subject and the details below, a link to the events of the interface; a
 * webhook's body as JSON with the event and a top-level `text`, which chat tools (Slack, Mattermost,
 * Rocket.Chat) show as the message. The texts of the events are German already (docs/plan.md).
 */

export type Ereignis = Pick<
  typeof ereignisse.$inferSelect,
  "ereignisId" | "zeitpunkt" | "art" | "schwere" | "ziel" | "text"
>;

export type Zustellung = { zustellungId: string; schwere: Schwere };

const ART: Record<Schwere, string> = { fehler: "Störung", warn: "Warnung", info: "Hinweis" };

/** The word before the subject: a fix is "Behoben", else the severity's name */
export const meldungsArt = (e: Ereignis, schwere: Schwere): string =>
  behobeneArt(e.art) === undefined ? ART[schwere] : "Behoben";

const BETREFF_MAX = 150;

const zeit = new Intl.DateTimeFormat("de-DE", {
  timeZone: ZEITZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

export const mailVon = (e: Ereignis, z: Zustellung, an: string, url: string): Mail => {
  const betreff = `[${meldungsArt(e, z.schwere)}] ${e.text}`;
  return {
    an,
    betreff: betreff.length > BETREFF_MAX ? `${betreff.slice(0, BETREFF_MAX - 1)}…` : betreff,
    text: [
      e.text,
      "",
      `Zeitpunkt: ${zeit.format(e.zeitpunkt)} (${ZEITZONE})`,
      `Schwere: ${e.schwere}`,
      `Art: ${e.art}`,
      `Ziel: ${e.ziel}`,
      "",
      `Ereignisse in der Steuerzentrale: ${url}/ereignisse`,
      "",
      "Diese Nachricht kommt von der Steuerzentrale; Empfänger und Ruhezeit stehen unter",
      "Einstellungen → Benachrichtigungen.",
    ].join("\n"),
    nachrichtId: `${z.zustellungId}@steuerzentrale`,
    datum: e.zeitpunkt,
    // the same id as a webhook's, so a mail of a repeated attempt can be recognised too
    kopf: { "X-Steuerzentrale-Zustellung": z.zustellungId },
  };
};

/** The body of a webhook: the same bytes are signed and sent */
export const webhookBody = (e: Ereignis, z: Zustellung): string =>
  JSON.stringify({
    typ: "ereignis",
    zustellung: z.zustellungId,
    text: `[${meldungsArt(e, z.schwere)}] ${e.text}`,
    ereignis: {
      id: e.ereignisId,
      zeitpunkt: e.zeitpunkt,
      art: e.art,
      schwere: e.schwere,
      ziel: e.ziel,
      text: e.text,
    },
  });

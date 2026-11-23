import type {
  Benachrichtigungen,
  BenachrichtigungsQuelle,
  Empfaenger,
} from "../daten/benachrichtigungen.ts";
import { berlin, JETZT } from "./zeit.ts";

/**
 * The notifications of the demo operator in memory, answering as the Zentrale's API does
 * (routes/benachrichtigungen.ts in apps/zentrale): the SMTP password only as set, a webhook only as
 * its origin, its URL and key never. A change lasts until the page reloads; a test message
 * "arrives" at every recipient.
 */
export const demoStart = (): Benachrichtigungen => ({
  smtp: {
    host: "smtp.beispiel-hosting.de",
    port: 587,
    sicherheit: "starttls",
    benutzer: "zentrale@beispiel-hosting.de",
    absender: "zentrale@beispiel-hosting.de",
    passwortGesetzt: true,
  },
  ruhezeit: { von: "22:00", bis: "07:00" },
  empfaenger: [
    {
      empfaengerId: "demo-mail",
      art: "mail",
      anzeige: "betrieb@beispiel-hosting.de",
      abSchwere: "warn",
      angelegtAm: berlin("2026-09-01", "10:00"),
    },
    {
      empfaengerId: "demo-chat",
      art: "webhook",
      anzeige: "https://chat.example",
      abSchwere: "fehler",
      angelegtAm: berlin("2026-09-01", "10:05"),
    },
  ],
  zustellungen: [
    {
      zustellungId: "demo-e1.demo-mail",
      ereignisText: "Störung atelier-haben: seit 5 Min. rot; Health: HTTP 503",
      empfaenger: "betrieb@beispiel-hosting.de",
      schwere: "fehler",
      zustand: "zugestellt",
      versuche: 1,
      fehler: null,
      angelegtAm: JETZT - 3 * 3600_000,
      faelligAm: JETZT - 3 * 3600_000,
      erledigtAm: JETZT - 3 * 3600_000 + 2000,
    },
    {
      zustellungId: "demo-e1.demo-chat",
      ereignisText: "Störung atelier-haben: seit 5 Min. rot; Health: HTTP 503",
      empfaenger: "https://chat.example",
      schwere: "fehler",
      zustand: "wartet",
      versuche: 2,
      fehler: "webhook HTTP 503",
      angelegtAm: JETZT - 3 * 3600_000,
      faelligAm: JETZT + 60_000,
      erledigtAm: null,
    },
  ],
});

export const demoBenachrichtigungen = (
  start: Benachrichtigungen = demoStart(),
  jetzt: () => number = () => JETZT,
): BenachrichtigungsQuelle => {
  let stand = structuredClone(start);
  const ok = <T>(daten: T) => ({ ok: true as const, status: 200, daten });
  return {
    lesen: async () => ok(structuredClone(stand)),
    setzen: async (neu) => {
      const gesetzt = stand.smtp?.passwortGesetzt ?? false;
      stand = {
        ...stand,
        smtp: neu.smtp && {
          host: neu.smtp.host,
          port: neu.smtp.port,
          sicherheit: neu.smtp.sicherheit,
          benutzer: neu.smtp.benutzer,
          absender: neu.smtp.absender,
          passwortGesetzt:
            neu.smtp.benutzer !== null && (gesetzt || neu.smtp.passwort !== undefined),
        },
        ruhezeit: neu.ruhezeit,
      };
      return ok(structuredClone(stand));
    },
    anlegen: async (neu) => {
      const r: Empfaenger = {
        empfaengerId: `demo-${stand.empfaenger.length + 1}-${jetzt()}`,
        art: neu.art,
        anzeige: neu.art === "mail" ? neu.adresse : new URL(neu.url).origin,
        abSchwere: neu.abSchwere,
        angelegtAm: jetzt(),
      };
      stand = { ...stand, empfaenger: [...stand.empfaenger, r] };
      return { ok: true, status: 201, daten: r };
    },
    entfernen: async (id) => {
      if (!stand.empfaenger.some((r) => r.empfaengerId === id))
        return { ok: false, status: 404, fehler: "nicht_gefunden" };
      stand = { ...stand, empfaenger: stand.empfaenger.filter((r) => r.empfaengerId !== id) };
      return { ok: true, status: 204, daten: null };
    },
    testen: async (id) =>
      stand.empfaenger.some((r) => r.empfaengerId === id)
        ? ok({ ok: true as const })
        : { ok: false, status: 404, fehler: "nicht_gefunden" },
  };
};

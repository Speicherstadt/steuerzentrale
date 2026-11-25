import { tagesbeginn } from "@steuerzentrale/planung";
import { getLocale, m } from "@steuerzentrale/ui";
import type { Termin } from "../daten/als-naechstes.ts";
import { berlinTeile, datum, uhrzeit } from "../format/zeit.ts";
import { welleName } from "../rahmen/texte.ts";

/*
 * The words of "Als Nächstes" (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): when, in the
 * shortest form that is clear ("heute 22:00", "Sa 03:00", "in 12 Tagen", "7.–12.12.", "30.11."), and
 * what in a title and a line.
 */

const TAG_MS = 86_400_000;

/** Calendar days in Berlin from `jetzt` to `zeit`; a day of 23 or 25 hours is one day */
const tageBis = (zeit: number, jetzt: number) =>
  Math.round((tagesbeginn(zeit) - tagesbeginn(jetzt)) / TAG_MS);

const wochentag = (zeit: number) =>
  new Intl.DateTimeFormat(getLocale() === "de" ? "de-DE" : "en-GB", {
    weekday: "short",
    timeZone: "Europe/Berlin",
  })
    .format(zeit)
    .replace(".", "");

/** "7.12." */
const tagMonat = (zeit: number) => {
  const t = berlinTeile(zeit);
  return `${Number(t.tag)}.${Number(t.monat)}.`;
};

/** An instant within the week: today, tomorrow, or the weekday, with the time */
const imLaufDerWoche = (zeit: number, jetzt: number) => {
  const tage = tageBis(zeit, jetzt);
  if (tage <= 0) return m.zeit_heute({ zeit: uhrzeit(zeit) });
  if (tage === 1) return m.zeit_morgen({ zeit: uhrzeit(zeit) });
  return `${wochentag(zeit)} ${uhrzeit(zeit)}`;
};

/** "7.–12.12.", or "28.1.–3.2." across a month's end; `ende` is the midnight after the last day */
const spanne = (beginn: number, ende: number) => {
  const letzter = ende - TAG_MS / 2;
  const erster = berlinTeile(beginn);
  return erster.monat === berlinTeile(letzter).monat
    ? `${Number(erster.tag)}.–${tagMonat(letzter)}`
    : `${tagMonat(beginn)}–${tagMonat(letzter)}`;
};

/** When a step happens, as the left column shows it */
export const wann = (t: Termin, jetzt: number): string => {
  switch (t.art) {
    case "update":
    case "neustart":
      return imLaufDerWoche(t.zeit, jetzt);
    case "zertifikat": {
      const tage = tageBis(t.zeit, jetzt);
      return tage <= 1 ? imLaufDerWoche(t.zeit, jetzt) : m.naechstes_in_tagen({ n: tage });
    }
    case "sperrzeit":
      return spanne(t.zeit, t.bis);
    case "vertrag":
    case "loeschung":
      return tagMonat(t.zeit);
  }
};

/** The customers of an update step: two by name, then how many more */
const kundenText = (kunden: string[]) =>
  kunden.length <= 2
    ? new Intl.ListFormat(getLocale() === "de" ? "de-DE" : "en-GB").format(kunden)
    : m.naechstes_kunden_mehr({ erste: kunden[0] ?? "", n: kunden.length - 1 });

/** The title and the line under it */
export const terminText = (t: Termin): { titel: string; text: string } => {
  switch (t.art) {
    case "update":
      return {
        titel: m.naechstes_update_bei({
          app: t.appName,
          version: t.version,
          kunden: kundenText(t.kunden),
        }),
        text: m.naechstes_update_text({ welle: welleName(t.welle) }),
      };
    case "neustart":
      return {
        titel: m.naechstes_neustart({ server: t.name }),
        text: t.kernel
          ? m.naechstes_neustart_kernel({ kernel: t.kernel })
          : m.naechstes_neustart_pakete(),
      };
    case "zertifikat":
      return {
        titel:
          t.hosts.length === 1
            ? m.naechstes_zertifikat()
            : m.naechstes_zertifikate({ n: t.hosts.length }),
        text: t.hosts.join(", "),
      };
    case "sperrzeit":
      return {
        titel: m.naechstes_sperrzeit({ app: t.appName }),
        text: m.naechstes_sperrzeit_text({ grund: t.grund }),
      };
    case "vertrag":
      return {
        titel: m.naechstes_vertrag({ kunde: t.kundeName }),
        text: m.naechstes_vertrag_text({ datum: datum(t.loeschenAb) }),
      };
    case "loeschung":
      return {
        titel: m.naechstes_loeschung({ kunde: t.kundeName }),
        text: m.naechstes_loeschung_text(),
      };
  }
};

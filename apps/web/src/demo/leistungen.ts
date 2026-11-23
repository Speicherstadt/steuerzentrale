import {
  type Leistungen,
  type LeistungsEingaben,
  leistungenCsv,
  leistungenImMonat,
  monatAusText,
  monatsGrenzen,
  verfuegbarkeitImMonat,
} from "@steuerzentrale/planung";
import type { LeistungenQuelle } from "../daten/leistungen.ts";
import type { Bestand } from "../daten/typen.ts";
import { demo } from "./index.ts";

/*
 * The services of the demo operator, answering as the Zentrale's API does (apps/zentrale,
 * routes/leistungen.ts) and summed by the same function: each installation's availability of a
 * month as one slice of the demo's percentage of the minutes up to its "now", its data as one
 * successful backup run, the support accesses as they are.
 */

const GIB = 1024 ** 3;

const eingaben = (b: Bestand, monat: string): LeistungsEingaben => {
  const m = monatAusText(monat);
  const von = m ? monatsGrenzen(m).von : 0;
  const minuten = m ? verfuegbarkeitImMonat([], m, b.jetzt).minuten : 0;
  return {
    kunden: b.kunden.map((k) => ({
      kundeId: k.id,
      intern: k.intern,
      vertragBeginn: k.vertrag.beginn,
      vertragEnde: k.vertrag.ende,
    })),
    installationen: b.installationen.map((i) => ({
      installationId: i.id,
      kundeId: i.kunde,
      app: i.app,
      laeuftSeit: i.laeuftSeit,
    })),
    scheiben: b.installationen.flatMap((i) => {
      const prozent = i.verfuegbarkeit[monat];
      if (prozent === undefined || minuten === 0) return [];
      const rot = Math.round((minuten * (100 - prozent)) / 100);
      return [{ installationId: i.id, stunde: von, gemessen: minuten, rot }];
    }),
    backups: b.installationen.map((i) => ({
      installationId: i.id,
      zeitpunkt: von,
      ok: true,
      teile: [{ bytes: Math.round(i.datenGb * GIB) }],
    })),
    zugaenge: b.zugaenge.map((z) => ({ kundeId: z.kundeId, beginn: z.beginn, endetAm: z.endetAm })),
  };
};

export const leistungenDerDemo = (b: Bestand, monat: string): Leistungen | undefined => {
  const m = monatAusText(monat);
  if (!m) return undefined;
  return {
    monat,
    kunden: leistungenImMonat(eingaben(b, monat), m, b.jetzt).map((l) => {
      const k = b.kunden.find((x) => x.id === l.kundeId);
      return { ...l, name: k?.name ?? l.kundeId, kuerzel: k?.kuerzel ?? "" };
    }),
  };
};

export const demoLeistungen = (b: Bestand = demo): LeistungenQuelle => ({
  imMonat: async (monat) => {
    const l = leistungenDerDemo(b, monat);
    return l
      ? { ok: true, status: 200, daten: l }
      : { ok: false, status: 400, fehler: "ungueltig" };
  },
  csvAdresse: (monat) => {
    const l = leistungenDerDemo(b, monat);
    return `data:text/csv;charset=utf-8,${encodeURIComponent(l ? leistungenCsv(l) : "")}`;
  },
});

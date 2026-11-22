import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import type { Fehlschlag } from "../anmeldung/api.ts";
import type { Einstellungswert } from "../daten/installationen.ts";
import { apps } from "./apps.ts";
import { type Eintrag, nachAuftrag } from "./installationen-bestand.ts";

/*
 * "Einstellungen ändern" in the demo (BAULISTE.md Z-404), answering as the Zentrale does
 * (apps/zentrale, modules/installationen/konfigurieren.ts): only for an installation that runs, not
 * in a freeze window of its app, not while a job of it is open, only values of its form. The job
 * stays open, as without an agent; the installation keeps its values until it would succeed.
 */

const ENDE = ["erfolgreich", "gescheitert", "abgebrochen"];

const nein = (status: number, fehler: string, detail?: string): Fehlschlag => ({
  ok: false,
  status,
  fehler,
  ...(detail === undefined ? {} : { detail }),
});

/** The day of the month in Berlin, as the freeze windows count it */
const tagInBerlin = (t: number) =>
  Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Berlin", day: "numeric" }).format(t));

const sperrzeit = (app: string, t: number) => {
  const tag = tagInBerlin(t);
  return apps
    .find((a) => a.id === app)
    ?.sperrzeiten.find((s) =>
      s.von <= s.bis ? tag >= s.von && tag <= s.bis : tag >= s.von || tag <= s.bis,
    );
};

export const demoKonfigurieren = (
  e: Eintrag,
  einstellungen: Readonly<Record<string, Einstellungswert>>,
  t: number,
): { ok: true; eintrag: Eintrag } | Fehlschlag => {
  if (e.i.zustand !== "laeuft") return nein(409, "laeuft_nicht");
  const sperre = sperrzeit(e.i.app, t);
  if (sperre) return nein(409, "sperrzeit", sperre.grund);
  if (e.i.auftraege.some((a) => !ENDE.includes(a.zustand))) return nein(409, "auftrag_offen");
  const fremd = Object.keys(einstellungen).find(
    (n) => !e.i.formular.felder.some((f) => f.name === n),
  );
  if (fremd)
    return nein(400, "einstellung_ungueltig", `${fremd}: the manifest has no such setting`);
  const job = nachAuftrag(e.i.installationId, EINRICHTUNG_AKTIONEN.konfigurieren, "zugestellt", t);
  return { ok: true, eintrag: { ...e, i: { ...e.i, auftraege: [...e.i.auftraege, job] } } };
};

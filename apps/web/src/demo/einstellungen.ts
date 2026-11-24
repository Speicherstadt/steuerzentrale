import type { EinstellungsFeld } from "@steuerzentrale/manifest";
import type { Fehlschlag } from "../anmeldung/api.ts";
import type { BetreiberEinstellungen, EinstellungenQuelle } from "../daten/einstellungen.ts";
import type { Einstellungswert } from "../daten/installationen.ts";
import type { Bestand, Ebene, Manifest } from "../daten/typen.ts";

/*
 * The settings in the demo (BAULISTE.md Z-404): the demo apps are no manifests, so their fields come
 * from the demo's variables, in the shape `einstellungsFormular` gives the Zentrale's answers, and
 * the operator's values from the demo operator, answering as the API does: a secret only as set,
 * an empty secret field keeps it, an empty text unsets it. A change lasts until the page reloads.
 */

export const demoFelder = (app: Manifest | undefined, ebene: Ebene): EinstellungsFeld[] =>
  (app?.variablen ?? [])
    .filter((v) => v.ebene === ebene)
    .map((v) => ({
      name: v.name,
      typ: v.geheim ? "geheim" : "text",
      pflicht: v.pflicht ?? false,
      vorgabe: v.vorgabe,
      titel: v.titel ?? v.name,
      beschreibung: v.hinweis,
      geheim: v.geheim ?? false,
      option: undefined,
    }));

const nein = (status: number, fehler: string, detail?: string): Fehlschlag => ({
  ok: false,
  status,
  fehler,
  ...(detail === undefined ? {} : { detail }),
});

type Stand = { werte: Record<string, Einstellungswert>; gesetzt: Set<string> };

/** What a value entered does to the stand: set it, unset an empty text, keep an empty secret */
const anwenden = (s: Stand, f: EinstellungsFeld, wert: Einstellungswert) => {
  if (f.geheim) {
    if (wert !== "") s.gesetzt.add(f.name);
  } else if (wert === "") delete s.werte[f.name];
  else s.werte[f.name] = wert;
};

const fehlt = (s: Stand, f: EinstellungsFeld) =>
  f.pflicht &&
  f.vorgabe === undefined &&
  (f.geheim ? !s.gesetzt.has(f.name) : !(f.name in s.werte));

export const demoEinstellungenQuelle = (b: Bestand): EinstellungenQuelle => {
  const stand: Stand = {
    werte: { ...b.betreiber.werte },
    gesetzt: new Set(b.betreiber.geheimGesetzt),
  };
  const installiert = () => new Set(b.installationen.map((i) => i.app));
  const antwort = (a: Manifest): BetreiberEinstellungen => {
    const felder = demoFelder(a, "betreiber");
    return {
      app: a.id,
      version: a.version ?? "–",
      felder,
      werte: Object.fromEntries(
        felder
          .filter((f) => !f.geheim && f.name in stand.werte)
          .map((f) => [f.name, stand.werte[f.name] as Einstellungswert]),
      ),
      gesetzt: felder.filter((f) => f.geheim && stand.gesetzt.has(f.name)).map((f) => f.name),
    };
  };
  return {
    apps: async () => ({
      ok: true,
      status: 200,
      daten: b.apps.filter((a) => installiert().has(a.id)).map(antwort),
    }),
    aendern: async (app, werte) => {
      const a = b.apps.find((x) => x.id === app);
      if (!a || !installiert().has(app)) return nein(404, "kein_manifest");
      const felder = demoFelder(a, "betreiber");
      const fremd = Object.keys(werte).find((n) => !felder.some((f) => f.name === n));
      if (fremd)
        return nein(400, "einstellung_ungueltig", `${fremd}: the manifest has no such setting`);
      const neu: Stand = { werte: { ...stand.werte }, gesetzt: new Set(stand.gesetzt) };
      for (const f of felder)
        if (f.name in werte) anwenden(neu, f, werte[f.name] as Einstellungswert);
      const ohne = felder.find((f) => fehlt(neu, f));
      if (ohne)
        return nein(400, "einstellung_ungueltig", `${ohne.name}: required and without a value`);
      stand.werte = neu.werte;
      stand.gesetzt = neu.gesetzt;
      return { ok: true, status: 200, daten: antwort(a) };
    },
  };
};

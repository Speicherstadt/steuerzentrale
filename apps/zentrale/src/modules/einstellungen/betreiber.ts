import {
  alleOptionen,
  befundeText,
  type EinstellungsFeld,
  einstellungenPruefen,
  einstellungsFormular,
  type FormularWerte,
  type Manifest,
  type Wert,
} from "@steuerzentrale/manifest";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { type Kontext, type Schreiber, schreiben } from "../audit/index.ts";
import { spalteVerschluesseln } from "../geheim/spalten.ts";
import { betreiberWerteLesen } from "../installationen/lesen.ts";
import { neuestesManifest } from "./manifest.ts";

/*
 * The operator's values of an app (BAULISTE.md Z-404; docs/plan.md, "Werte des Betreibers
 * schreiben"): read and written as the form of the level `betreiber` of the app's newest manifest
 * (`einstellungsFormular`), each written value checked with `einstellungenPruefen`. A secret one is
 * stored encrypted and comes back only as "set"; an empty secret field keeps the old value. Every
 * write goes through the audit log with its reason.
 */

export type EinstellungsDeps = { db: Db; schreibDb: SchreibDb; schluessel: Schluesselbund };

/** The operator's values of an app as the API shows them: never a secret, only its name */
export type BetreiberEinstellungen = {
  app: string;
  version: string;
  felder: EinstellungsFeld[];
  /** The values that are not secret, by name */
  werte: Record<string, Wert>;
  /** The names of the secret values that are set */
  gesetzt: string[];
};

export type EinstellungsFehler = "kein_manifest" | "werte_unlesbar" | "einstellung_ungueltig";

export type Gelesen =
  | { ok: true; einstellungen: BetreiberEinstellungen }
  | { ok: false; grund: EinstellungsFehler; detail?: string };

const antwort = (m: Manifest, werte: FormularWerte): BetreiberEinstellungen => {
  const felder = einstellungsFormular(m, "betreiber", alleOptionen(m));
  // a value stored in plain text under an older manifest is secret once this one says so
  const gesetzt = (name: string) => name in werte.geheim || name in werte.offen;
  return {
    app: m.id,
    version: m.version,
    felder,
    werte: Object.fromEntries(
      felder
        .filter((f) => !f.geheim && f.name in werte.offen)
        .map((f) => [f.name, werte.offen[f.name] as Wert]),
    ),
    gesetzt: felder.filter((f) => f.geheim && gesetzt(f.name)).map((f) => f.name),
  };
};

/**
 * Writes the changed values of the form's fields within the caller's change: a new or changed value
 * as its row (a secret one encrypted, bound to the row), a value no longer set removed. Values of
 * names the form does not have stay: an older manifest of another installation may still use them.
 */
export const betreiberWerteSchreiben = (
  w: Schreiber,
  bund: Schluesselbund,
  ziel: { betreiberId: string; app: string; jetzt: number },
  felder: readonly EinstellungsFeld[],
  bisher: FormularWerte,
  neu: FormularWerte,
): void => {
  const { betreiberId, app, jetzt } = ziel;
  for (const f of felder) {
    const vorhanden = f.name in bisher.geheim || f.name in bisher.offen;
    // the same value in the column of its kind is no change
    const alt = f.geheim ? bisher.geheim[f.name] : bisher.offen[f.name];
    const wert = f.geheim ? neu.geheim[f.name] : neu.offen[f.name];
    const schluessel = { app, name: f.name };
    if (wert === alt) continue;
    if (wert === undefined) {
      w.loeschen("appEinstellungen", schluessel);
      continue;
    }
    const text = JSON.stringify(wert);
    const spalten = f.geheim
      ? {
          wert: null,
          wertVerschluesselt: spalteVerschluesseln(
            bund,
            "appEinstellungen",
            betreiberId,
            schluessel,
            text,
          ),
        }
      : { wert: text, wertVerschluesselt: null };
    if (vorhanden) w.aendern("appEinstellungen", schluessel, { ...spalten, geaendertAm: jetzt });
    else
      w.einfuegen("appEinstellungen", {
        betreiberId,
        ...schluessel,
        ...spalten,
        geaendertAm: jetzt,
      });
  }
};

/** The operator's values of an app with the form of its newest manifest */
export const betreiberEinstellungenLesen = (
  deps: Pick<EinstellungsDeps, "db" | "schluessel">,
  betreiberId: string,
  app: string,
): Gelesen => {
  const m = neuestesManifest(deps.db, app);
  if (!m) return { ok: false, grund: "kein_manifest" };
  const werte = betreiberWerteLesen(deps.db, deps.schluessel, betreiberId, app);
  if (!werte.ok) return { ok: false, grund: "werte_unlesbar", detail: werte.grund };
  return { ok: true, einstellungen: antwort(m, werte.werte) };
};

/** Changes the operator's values of an app, checked against the form of its newest manifest */
export const betreiberEinstellungenAendern = (
  deps: EinstellungsDeps,
  kontext: Kontext,
  app: string,
  eingabe: Readonly<Record<string, Wert>>,
): Gelesen => {
  const { betreiberId, jetzt } = kontext;
  const m = neuestesManifest(deps.db, app);
  if (!m) return { ok: false, grund: "kein_manifest" };
  const bisher = betreiberWerteLesen(deps.db, deps.schluessel, betreiberId, app);
  if (!bisher.ok) return { ok: false, grund: "werte_unlesbar", detail: bisher.grund };
  const optionen = alleOptionen(m);
  const geprueft = einstellungenPruefen(m, "betreiber", optionen, eingabe, bisher.werte);
  if (!geprueft.ok)
    return { ok: false, grund: "einstellung_ungueltig", detail: befundeText(geprueft.befunde) };
  const felder = einstellungsFormular(m, "betreiber", optionen);
  schreiben(deps.schreibDb, kontext, "app_einstellungen.aendern", (w) =>
    betreiberWerteSchreiben(
      w,
      deps.schluessel,
      { betreiberId, app, jetzt },
      felder,
      bisher.werte,
      geprueft.werte,
    ),
  );
  return betreiberEinstellungenLesen(deps, betreiberId, app);
};

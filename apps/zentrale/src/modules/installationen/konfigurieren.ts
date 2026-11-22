import {
  befundeText,
  EINRICHTUNG_AKTIONEN,
  type EinstellungsFeld,
  einstellungenPruefen,
  einstellungsFormular,
  manifestPruefen,
  type Wert,
} from "@steuerzentrale/manifest";
import { sperrzeitAm } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { type AnlageFehler, auftragEinfuegen, auftragVorbereiten } from "../auftraege/anlegen.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { spalteEntschluesseln } from "../geheim/spalten.ts";
import {
  einrichtungAus,
  type GeheimeEinstellungen,
  type OffeneEinstellungen,
} from "./einrichtung.ts";
import { konfigurationZeile } from "./konfiguration.ts";
import {
  auftraegeDerInstallation,
  betreiberWerteLesen,
  type Installation,
  installationLesen,
} from "./lesen.ts";
import { betreiberWerteFuer } from "./werte.ts";

/*
 * "Einstellungen ändern" (BAULISTE.md Z-404; docs/plan.md, "Neu konfigurieren"): new values of the
 * level `installation`, checked against the form of the installation's manifest, together with the
 * operator's current values, rendered against with `einrichtungAuftragPruefen` (through
 * auftragVorbereiten) and sent as the job `installation_konfigurieren`. Only for an installation
 * that runs, never in a freeze window of its manifest, never while another job of it is open.
 * Options, ports and generated values stay. The asked values wait in their own row
 * (konfiguration.ts) until the job succeeded.
 */

export type Konfiguriert =
  | { ok: true; auftrag: Auftrag }
  | {
      ok: false;
      grund:
        | "keine_installation"
        | "laeuft_nicht"
        | "sperrzeit"
        | "auftrag_offen"
        | "werte_unlesbar"
        | "einstellung_ungueltig"
        | "nicht_einrichtbar"
        | AnlageFehler;
      detail?: string;
    };

type Fehler = Extract<Konfiguriert, { ok: false }>;

type Neu = { offen: OffeneEinstellungen; geheim: GeheimeEinstellungen };

/** The installation's values after the change, or why there are none */
const neueWerte = (
  deps: AuftragDeps,
  betreiberId: string,
  i: Installation,
  eingabe: Readonly<Record<string, Wert>>,
): ({ ok: true } & Neu) | Fehler => {
  const geprueft = manifestPruefen(i.manifest);
  if (!geprueft.ok) return { ok: false, grund: "manifest_ungueltig" };
  const m = geprueft.manifest;
  const klar = spalteEntschluesseln(deps.schluessel, "installationen", betreiberId, i, i.geheim);
  const betreiber = betreiberWerteLesen(deps.db, deps.schluessel, betreiberId, m.id);
  if (!klar.ok || !betreiber.ok) return { ok: false, grund: "werte_unlesbar" };
  const alt = JSON.parse(klar.wert) as GeheimeEinstellungen;
  const offen = JSON.parse(i.einstellungen) as OffeneEinstellungen;
  const optionen = JSON.parse(i.optionen) as string[];
  const iw = einstellungenPruefen(m, "installation", optionen, eingabe, {
    offen: offen.installation,
    geheim: alt.installation,
  });
  if (!iw.ok) return { ok: false, grund: "einstellung_ungueltig", detail: befundeText(iw.befunde) };
  const bw = betreiberWerteFuer(m, betreiber.werte);
  return {
    ok: true,
    offen: { betreiber: bw.offen, installation: iw.werte.offen },
    geheim: { betreiber: bw.geheim, installation: iw.werte.geheim, auto: alt.auto },
  };
};

/** Why the installation cannot be configured now, or undefined */
const gesperrt = (deps: AuftragDeps, kontext: Kontext, i: Installation): Fehler | undefined => {
  if (i.zustand !== "laeuft") return { ok: false, grund: "laeuft_nicht" };
  const m = manifestPruefen(i.manifest);
  const sperre = m.ok ? sperrzeitAm(m.manifest.sperrzeiten, kontext.jetzt) : undefined;
  if (sperre) return { ok: false, grund: "sperrzeit", detail: sperre.grund };
  const offen = auftraegeDerInstallation(deps.db, kontext.betreiberId, i.installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );
  return offen ? { ok: false, grund: "auftrag_offen" } : undefined;
};

/**
 * The form of the installation's level `installation` for its page, with the options it chose, and
 * the names of its secret values that are set: the values themselves never leave the Zentrale
 */
export const installationsFormular = (
  bund: Schluesselbund,
  i: Installation,
): { felder: EinstellungsFeld[]; gesetzt: string[] } => {
  const m = manifestPruefen(i.manifest);
  if (!m.ok) return { felder: [], gesetzt: [] };
  const klar = spalteEntschluesseln(bund, "installationen", i.betreiberId, i, i.geheim);
  const geheim = klar.ok ? (JSON.parse(klar.wert) as GeheimeEinstellungen).installation : {};
  return {
    felder: einstellungsFormular(m.manifest, "installation", JSON.parse(i.optionen) as string[]),
    gesetzt: Object.keys(geheim),
  };
};

export const installationKonfigurieren = (
  deps: AuftragDeps,
  kontext: Kontext,
  installationId: string,
  eingabe: Readonly<Record<string, Wert>>,
): Konfiguriert => {
  const { betreiberId, jetzt } = kontext;
  const i = installationLesen(deps.db, betreiberId, installationId);
  if (!i) return { ok: false, grund: "keine_installation" };
  const nein = gesperrt(deps, kontext, i);
  if (nein) return nein;
  const neu = neueWerte(deps, betreiberId, i, eingabe);
  if (!neu.ok) return neu;
  const einrichtung = einrichtungAus(
    { ...i, einstellungen: JSON.stringify(neu.offen) },
    neu.geheim,
  );
  const vorbereitet = auftragVorbereiten(deps, kontext, {
    serverId: i.serverId,
    installationId,
    aktion: EINRICHTUNG_AKTIONEN.konfigurieren,
    argumente: {},
    manifest: i.manifest,
    signatur: i.signatur,
    einrichtung,
  });
  if (!vorbereitet.ok)
    return {
      ok: false,
      grund: "nicht_einrichtbar",
      detail: vorbereitet.detail ?? vorbereitet.grund,
    };
  const ziel = { betreiberId, auftragId: vorbereitet.zeile.auftragId, installationId, jetzt };
  const auftrag = schreiben(deps.schreibDb, kontext, "installation.konfigurieren", (w) => {
    const zeile = auftragEinfuegen(w, vorbereitet.zeile);
    w.einfuegen(
      "installationKonfigurationen",
      konfigurationZeile(deps.schluessel, ziel, neu.offen, neu.geheim),
    );
    return zeile;
  });
  zustellen(deps, [auftrag]);
  return { ok: true, auftrag };
};

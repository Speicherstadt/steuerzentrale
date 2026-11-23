import { befundeText, einstellungenPruefen, type Manifest } from "@steuerzentrale/manifest";
import type { Db } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { spalteEntschluesseln } from "../geheim/spalten.ts";
import type { GeheimeEinstellungen, OffeneEinstellungen } from "../installationen/einrichtung.ts";
import { betreiberWerteLesen, type Installation } from "../installationen/lesen.ts";
import { autoWerteErzeugen, betreiberWerteFuer, type Zufall } from "../installationen/werte.ts";

/*
 * The installation's values for a new version (BAULISTE.md Z-503; docs/plan.md, "Update in der
 * Zentrale (Z-503)"): its values of the level `installation` checked against the new manifest's
 * form, so a required value the new version adds without a default stops the update before
 * anything is made; the operator's current values for the app as the new manifest takes them; its
 * generated `auto` values kept, and one the new version adds generated once. Nothing else changes:
 * options, ports and host stay.
 */

export type NeueWerte =
  | { ok: true; offen: OffeneEinstellungen; geheim: GeheimeEinstellungen }
  | { ok: false; grund: "werte_unlesbar" | "werte_fehlen"; detail?: string };

export const updateWerte = (
  deps: { db: Db; schluessel: Schluesselbund; zufall: Zufall },
  i: Installation,
  m: Manifest,
): NeueWerte => {
  const klar = spalteEntschluesseln(deps.schluessel, "installationen", i.betreiberId, i, i.geheim);
  const betreiber = betreiberWerteLesen(deps.db, deps.schluessel, i.betreiberId, m.id);
  if (!klar.ok || !betreiber.ok) return { ok: false, grund: "werte_unlesbar" };
  const alt = JSON.parse(klar.wert) as GeheimeEinstellungen;
  const offen = JSON.parse(i.einstellungen) as OffeneEinstellungen;
  const optionen = JSON.parse(i.optionen) as string[];
  const iw = einstellungenPruefen(
    m,
    "installation",
    optionen,
    {},
    {
      offen: offen.installation,
      geheim: alt.installation,
    },
  );
  if (!iw.ok) return { ok: false, grund: "werte_fehlen", detail: befundeText(iw.befunde) };
  const bw = betreiberWerteFuer(m, betreiber.werte);
  return {
    ok: true,
    offen: { betreiber: bw.offen, installation: iw.werte.offen },
    geheim: {
      betreiber: bw.geheim,
      installation: iw.werte.geheim,
      auto: autoWerte(m, optionen, alt.auto, deps.zufall),
    },
  };
};

/** The generated values the new manifest names: each kept, one it adds made now */
const autoWerte = (
  m: Manifest,
  optionen: readonly string[],
  alt: GeheimeEinstellungen["auto"],
  zufall: Zufall,
): GeheimeEinstellungen["auto"] => {
  const namen = new Set(m.env.filter((e) => e.ebene === "auto").map((e) => e.name));
  const behalten = Object.entries(alt).filter(([name]) => namen.has(name));
  return { ...autoWerteErzeugen(m, optionen, zufall), ...Object.fromEntries(behalten) };
};

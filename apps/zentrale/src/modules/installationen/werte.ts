import {
  alleOptionen,
  befundeText,
  einstellungenPruefen,
  einstellungsFormular,
  type Manifest,
  type Wert,
} from "@steuerzentrale/manifest";
import type { Werte } from "./lesen.ts";

/*
 * The values of a new installation by level (docs/plan.md, "Vorlagen und erzeugte Werte"): what
 * the operator entered in the dialog for the level `installation`, checked against the manifest's
 * form (`einstellungenPruefen`, BAULISTE.md Z-404), the operator's values for the app with what the
 * dialog adds to them, and the `auto` values the Zentrale generates once. A secret value (type
 * `geheim`) is kept apart, so it lands only in the encrypted column. Pure; the random bytes are
 * passed in.
 */

type Einstellung = Manifest["env"][number];

/** n random bytes (node:crypto's randomBytes outside tests) */
export type Zufall = (n: number) => Uint8Array;

const aktiv = (m: Manifest, optionen: readonly string[]): Einstellung[] =>
  m.env.filter((e) => e.option === undefined || optionen.includes(e.option));

export type Geprueft = { ok: true; werte: Werte } | { ok: false; grund: string };

/** The values entered for the level `installation`, checked against the form of the manifest */
export const installationsWerte = (
  m: Manifest,
  optionen: readonly string[],
  eingabe: Readonly<Record<string, Wert>>,
): Geprueft => {
  const geprueft = einstellungenPruefen(m, "installation", optionen, eingabe);
  return geprueft.ok
    ? { ok: true, werte: geprueft.werte }
    : { ok: false, grund: befundeText(geprueft.befunde) };
};

/** The operator's values with what the dialog adds; `neu` holds the fields of the form only */
export type Ergaenzt = { ok: true; werte: Werte; neu: Werte } | { ok: false; grund: string };

/**
 * The operator's stored values with the values the dialog "App installieren" adds (Z-404),
 * checked against the form of the level `betreiber` of the uploaded manifest; a required value
 * still missing is left to the placement, which names it
 */
export const betreiberWerteErgaenzen = (
  m: Manifest,
  gespeichert: Werte,
  eingabe: Readonly<Record<string, Wert>>,
): Ergaenzt => {
  const geprueft = einstellungenPruefen(m, "betreiber", alleOptionen(m), eingabe, gespeichert, {
    pflicht: false,
  });
  if (!geprueft.ok) return { ok: false, grund: befundeText(geprueft.befunde) };
  const imFormular = new Set(
    einstellungsFormular(m, "betreiber", alleOptionen(m)).map((f) => f.name),
  );
  const ohne = (werte: Record<string, Wert>) =>
    Object.fromEntries(Object.entries(werte).filter(([name]) => !imFormular.has(name)));
  return {
    ok: true,
    werte: {
      offen: { ...ohne(gespeichert.offen), ...geprueft.werte.offen },
      geheim: { ...ohne(gespeichert.geheim), ...geprueft.werte.geheim },
    },
    neu: geprueft.werte,
  };
};

/**
 * The operator's values as the installation keeps them: only settings of the level `betreiber`,
 * and a value stored encrypted or of type `geheim` among the secret ones
 */
export const betreiberWerteFuer = (m: Manifest, gespeichert: Werte): Werte => {
  const werte: Werte = { offen: {}, geheim: {} };
  for (const e of m.env.filter((x) => x.ebene === "betreiber")) {
    const geheim = gespeichert.geheim[e.name];
    const offen = gespeichert.offen[e.name];
    if (geheim !== undefined) werte.geheim[e.name] = geheim;
    else if (offen !== undefined) (e.typ === "geheim" ? werte.geheim : werte.offen)[e.name] = offen;
  }
  return werte;
};

const ERZEUGEN: Record<NonNullable<Einstellung["erzeugen"]>, (z: Zufall) => string> = {
  zufall_32: (z) => Buffer.from(z(32)).toString("base64"),
  zufall_64: (z) => Buffer.from(z(64)).toString("base64"),
  zufall_hex_32: (z) => Buffer.from(z(32)).toString("hex"),
};

/** A value for every `auto` setting with `erzeugen` that applies with the chosen options */
export const autoWerteErzeugen = (
  m: Manifest,
  optionen: readonly string[],
  zufall: Zufall,
): Record<string, string> =>
  Object.fromEntries(
    aktiv(m, optionen)
      .filter((e) => e.ebene === "auto" && e.erzeugen !== undefined)
      .map((e) => [e.name, ERZEUGEN[e.erzeugen as keyof typeof ERZEUGEN](zufall)]),
  );

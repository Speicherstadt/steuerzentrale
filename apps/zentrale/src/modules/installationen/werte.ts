import type { Manifest, Wert } from "@steuerzentrale/manifest";
import type { Werte } from "./lesen.ts";

/*
 * The values of a new installation by level (docs/plan.md, "Vorlagen und erzeugte Werte"): what
 * the operator entered in the dialog for the level `installation`, checked against the manifest,
 * the operator's values for the app, and the `auto` values the Zentrale generates once. A secret
 * value (type `geheim`) is kept apart, so it lands only in the encrypted column. Pure; the random
 * bytes are passed in.
 */

type Einstellung = Manifest["env"][number];

/** n random bytes (node:crypto's randomBytes outside tests) */
export type Zufall = (n: number) => Uint8Array;

const aktiv = (m: Manifest, optionen: readonly string[]): Einstellung[] =>
  m.env.filter((e) => e.option === undefined || optionen.includes(e.option));

const passtZumTyp = (e: Einstellung, wert: Wert): boolean => {
  if (e.typ === "zahl") return typeof wert === "number" && Number.isFinite(wert);
  if (e.typ === "ja_nein") return typeof wert === "boolean";
  return typeof wert === "string";
};

export type Geprueft = { ok: true; werte: Werte } | { ok: false; grund: string };

/**
 * The values entered for the level `installation`: each must be a setting of that level which
 * applies with the chosen options, is no template, and has a value of its type
 */
export const installationsWerte = (
  m: Manifest,
  optionen: readonly string[],
  eingabe: Readonly<Record<string, Wert>>,
): Geprueft => {
  const einstellungen = aktiv(m, optionen);
  const werte: Werte = { offen: {}, geheim: {} };
  for (const [name, wert] of Object.entries(eingabe)) {
    const e = einstellungen.find((x) => x.name === name);
    if (e?.ebene !== "installation" || e.vorlage !== undefined)
      return { ok: false, grund: `${name}: no setting of the level installation` };
    if (!passtZumTyp(e, wert)) return { ok: false, grund: `${name}: a value of type ${e.typ}` };
    (e.typ === "geheim" ? werte.geheim : werte.offen)[name] = wert;
  }
  return { ok: true, werte };
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

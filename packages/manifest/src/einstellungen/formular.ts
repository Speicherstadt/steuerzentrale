import type { Wert } from "../quadlet/typen.ts";
import type { Manifest } from "../schema.ts";

/*
 * The form of the settings (BAULISTE.md Z-404; docs/plan.md, "Formular der Einstellungen"): the
 * fields of one level of a manifest's `env` and the check of the values written for it. The
 * interface builds its forms with the same function the Zentrale checks every written value with,
 * so what one offers the other takes. `auto` values are no fields, nor templates (only an `auto`
 * value has one, regelnPruefen). Pure, and no app
 * is known by name.
 */

/** The levels a person sets values for; `auto` values the Zentrale generates or derives */
export type FormularEbene = "betreiber" | "installation";

type Einstellung = Manifest["env"][number];

export type Feld = {
  name: string;
  typ: Einstellung["typ"];
  /** Required by the manifest; a default counts as a value */
  pflicht: boolean;
  vorgabe: Wert | undefined;
  /** What a person reads: the manifest's `titel`, else the setting's name */
  titel: string;
  beschreibung: string | undefined;
  /** Stored encrypted and never shown again: an empty field keeps the value */
  geheim: boolean;
  /** The option it belongs to; it applies only while the option is on */
  option: string | undefined;
};

/** Values by name, split into those that may be shown and the secret ones */
export type FormularWerte = { offen: Record<string, Wert>; geheim: Record<string, Wert> };

const alsFeld = (e: Einstellung): Feld => ({
  name: e.name,
  typ: e.typ,
  pflicht: e.pflicht,
  vorgabe: e.vorgabe,
  titel: e.titel ?? e.name,
  beschreibung: e.beschreibung,
  geheim: e.typ === "geheim",
  option: e.option,
});

const gilt = (e: Einstellung, optionen: readonly string[]) =>
  e.option === undefined || optionen.includes(e.option);

/** The fields of one level that apply with the options, in the manifest's order */
export const einstellungsFormular = (
  m: Manifest,
  ebene: FormularEbene,
  optionen: readonly string[],
): Feld[] => m.env.filter((e) => e.ebene === ebene && gilt(e, optionen)).map(alsFeld);

/** Every option of the manifest: the operator's values serve every installation, whatever it chose */
export const alleOptionen = (m: Manifest): string[] => m.optionen.map((o) => o.id);

export type FormularBefund = {
  name: string;
  code: "unbekannt" | "ebene" | "kein_feld" | "typ" | "pflicht";
};

export type FormularGeprueft =
  | { ok: true; werte: FormularWerte }
  | { ok: false; befunde: FormularBefund[] };

const passtZumTyp = (f: Feld, wert: Wert): boolean => {
  if (f.typ === "zahl") return typeof wert === "number" && Number.isFinite(wert);
  if (f.typ === "ja_nein") return typeof wert === "boolean";
  return typeof wert === "string";
};

/** Why a name entered is no field of the form, or undefined when it is one */
const fremd = (m: Manifest, ebene: FormularEbene, name: string): FormularBefund | undefined => {
  const e = m.env.find((x) => x.name === name);
  if (!e) return { name, code: "unbekannt" };
  return { name, code: e.ebene === ebene ? "kein_feld" : "ebene" };
};

/** The field's value after the change; undefined when it has none */
const neuerWert = (
  f: Feld,
  eingabe: Readonly<Record<string, Wert>>,
  bisher: FormularWerte,
): Wert | undefined => {
  const wert = eingabe[f.name];
  const alt = f.geheim ? bisher.geheim[f.name] : bisher.offen[f.name];
  if (wert === undefined) return alt;
  if (wert === "") return f.geheim ? alt : undefined;
  return wert;
};

/**
 * Checks the values entered for one level and returns the level's values after the change.
 * `eingabe` holds the fields to change: a value replaces the one kept so far (`bisher`), an empty
 * text unsets it, an empty secret keeps it (the form never shows a secret, so empty means "keep");
 * a field not entered stays as it was. Refused: a name the manifest does not know, one of another
 * level, a setting of an option that is off, a value not of the field's type, and a required
 * field left without a value and without a default. `pflicht: false` leaves the last to the
 * caller: the dialog "App installieren" adds values to the operator's, and the placement names a
 * required one still missing (`betreiberwert_fehlt`).
 */
export const einstellungenPruefen = (
  m: Manifest,
  ebene: FormularEbene,
  optionen: readonly string[],
  eingabe: Readonly<Record<string, Wert>>,
  bisher: FormularWerte = { offen: {}, geheim: {} },
  { pflicht = true }: { pflicht?: boolean } = {},
): FormularGeprueft => {
  const felder = einstellungsFormular(m, ebene, optionen);
  const befunde: FormularBefund[] = [];
  for (const [name, wert] of Object.entries(eingabe)) {
    const f = felder.find((x) => x.name === name);
    if (!f) befunde.push(fremd(m, ebene, name) as FormularBefund);
    else if (wert !== "" && !passtZumTyp(f, wert)) befunde.push({ name, code: "typ" });
  }
  const werte: FormularWerte = { offen: {}, geheim: {} };
  for (const f of felder) {
    const wert = neuerWert(f, eingabe, bisher);
    if (wert !== undefined) (f.geheim ? werte.geheim : werte.offen)[f.name] = wert;
    else if (pflicht && f.pflicht && f.vorgabe === undefined)
      befunde.push({ name: f.name, code: "pflicht" });
  }
  return befunde.length > 0 ? { ok: false, befunde } : { ok: true, werte };
};

const BEFUND_TEXT: Record<FormularBefund["code"], string> = {
  unbekannt: "the manifest has no such setting",
  ebene: "a setting of another level",
  kein_feld: "a setting of an option that is off",
  typ: "a value of another type",
  pflicht: "required and without a value",
};

/** The findings as one line, for an API's `detail` */
export const befundeText = (befunde: readonly FormularBefund[]): string =>
  befunde.map((b) => `${b.name}: ${BEFUND_TEXT[b.code]}`).join("; ");

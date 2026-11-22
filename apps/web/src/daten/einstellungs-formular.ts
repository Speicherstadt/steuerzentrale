import type { EinstellungsFeld } from "@steuerzentrale/manifest";
import type { Einstellungswert } from "./installationen.ts";

/*
 * The forms of the settings (BAULISTE.md Z-402, Z-404): their fields come from
 * `einstellungsFormular` in packages/manifest, the function the Zentrale checks every written value
 * with, either in the browser from an uploaded manifest or from the Zentrale's answer. Pure: the
 * form gives text, the API takes a value of the setting's type. No app is known by name.
 */

export type Feld = EinstellungsFeld;

/**
 * The form field's name: apart from the dialog's own fields (host, reason), and the operator's
 * fields (`betreiber`) apart from the installation's
 */
export const feldName = (einstellung: string, praefix = "env") => `${praefix}:${einstellung}`;

/** Whether a yes/no setting starts ticked: its value, else its default, also written as text */
export const angehakt = (f: Feld, wert?: Einstellungswert): boolean => {
  const w = wert ?? f.vorgabe;
  return w === true || w === "true";
};

const wert = (f: Feld, text: string | undefined): Einstellungswert | undefined => {
  if (f.typ === "ja_nein") return text !== undefined;
  if (text === undefined || text === "") return undefined;
  return f.typ === "zahl" ? Number(text) : text;
};

/**
 * The values to send from the form's fields (src/seiten/anmeldung-teile.tsx, `felder`: trimmed,
 * empty ones left out): a yes/no setting always, as the checkbox is sent only when ticked. A new
 * installation leaves an empty field out, so the manifest's default applies; a change
 * (`aendern`) sends an empty text as "" so the Zentrale unsets it, and leaves an empty secret out,
 * which keeps its value.
 */
export const einstellungenAus = (
  felder: readonly Feld[],
  eingabe: Readonly<Record<string, string>>,
  { aendern = false }: { aendern?: boolean } = {},
): Record<string, Einstellungswert> =>
  Object.fromEntries(
    felder.flatMap((f) => {
      const w = wert(f, eingabe[feldName(f.name)]);
      if (w !== undefined) return [[f.name, w] as const];
      return aendern && !f.geheim ? [[f.name, ""] as const] : [];
    }),
  );

/**
 * Only the values entered, with their type: the operator's fields the dialog "App installieren"
 * asks for (Z-404) add to the stored values and never unset one
 */
export const eingetragen = (
  felder: readonly Feld[],
  eingabe: Readonly<Record<string, string>>,
  praefix: string,
): Record<string, Einstellungswert> =>
  Object.fromEntries(
    felder.flatMap((f) => {
      const text = eingabe[feldName(f.name, praefix)];
      const w = text === undefined ? undefined : wert(f, text);
      return w === undefined ? [] : [[f.name, w] as const];
    }),
  );

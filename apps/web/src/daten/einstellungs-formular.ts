import type { Manifest } from "@steuerzentrale/manifest";
import type { Einstellungswert } from "./installationen.ts";

/*
 * The settings of the level `installation` as the dialog "Installieren" asks for them (BAULISTE.md
 * Z-402): one field per setting of the manifest's `env` that applies with the chosen options and is
 * no template, as the Zentrale checks them (apps/zentrale, modules/installationen/werte.ts). Pure:
 * the form gives text, the API takes a value of the setting's type. No app is known by name.
 */

export type Feld = {
  name: string;
  typ: "text" | "zahl" | "ja_nein" | "geheim";
  /** Without a default the setting must be entered, else the units do not render */
  noetig: boolean;
  vorgabe: Einstellungswert | undefined;
  beschreibung: string | undefined;
};

/** The form field's name: apart from the dialog's own fields (host, reason) */
export const feldName = (einstellung: string) => `env:${einstellung}`;

export const installationsFelder = (m: Manifest, optionen: readonly string[]): Feld[] =>
  m.env
    .filter((e) => e.ebene === "installation" && e.vorlage === undefined)
    .filter((e) => e.option === undefined || optionen.includes(e.option))
    .map((e) => ({
      name: e.name,
      typ: e.typ,
      noetig: e.pflicht || (e.vorgabe === undefined && e.typ !== "ja_nein"),
      vorgabe: e.vorgabe,
      beschreibung: e.beschreibung,
    }));

/** Whether a yes/no setting starts ticked: its default, also written as text */
export const angehakt = (f: Feld): boolean => f.vorgabe === true || f.vorgabe === "true";

const wert = (f: Feld, text: string | undefined): Einstellungswert | undefined => {
  if (f.typ === "ja_nein") return text !== undefined;
  if (text === undefined || text === "") return undefined;
  return f.typ === "zahl" ? Number(text) : text;
};

/**
 * The values to send from the form's fields (src/seiten/anmeldung-teile.tsx, `felder`: trimmed,
 * empty ones left out): a yes/no setting always, as the checkbox is sent only when ticked; an empty
 * field is left out, so the manifest's default applies
 */
export const einstellungenAus = (
  felder: readonly Feld[],
  eingabe: Readonly<Record<string, string>>,
): Record<string, Einstellungswert> =>
  Object.fromEntries(
    felder.flatMap((f) => {
      const w = wert(f, eingabe[feldName(f.name)]);
      return w === undefined ? [] : [[f.name, w] as const];
    }),
  );

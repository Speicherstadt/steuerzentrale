import { Input, m } from "@steuerzentrale/ui";
import { For, Show } from "solid-js";
import { angehakt, type Feld, feldName } from "../daten/einstellungs-formular.ts";
import type { Einstellungswert } from "../daten/installationen.ts";

/*
 * The fields of a settings form (BAULISTE.md Z-402, Z-404), one per field of
 * `einstellungsFormular`: text, number, password for a secret, a checkbox for yes/no. A form that
 * changes values shows the current ones; a secret never comes back, so its field stays empty and
 * says whether a value is set (an empty field keeps it). No app is known by name.
 */

/** What a form that changes values knows: the values that may be shown, the secrets that are set */
export type Bestand = { werte: Record<string, Einstellungswert>; gesetzt: readonly string[] };

const haken = "size-4 accent-[hsl(var(--primary))]";

const geheimText = (f: Feld, bestand: Bestand | undefined) =>
  bestand === undefined
    ? undefined
    : bestand.gesetzt.includes(f.name)
      ? m.einst_geheim_gesetzt()
      : m.einst_nicht_gesetzt();

const hinweis = (f: Feld, bestand: Bestand | undefined) =>
  [
    f.beschreibung,
    f.vorgabe === undefined ? undefined : m.installieren_vorgabe({ wert: String(f.vorgabe) }),
    f.option === undefined ? undefined : m.einst_nur_mit_option({ option: f.option }),
    f.geheim ? geheimText(f, bestand) : undefined,
  ]
    .filter(Boolean)
    .join(" · ") || undefined;

const EINGABE = { text: "text", zahl: "number", geheim: "password" } as const;

/** Required unless it has a default, or it is a secret already set (empty keeps it) */
const noetig = (f: Feld, bestand: Bestand | undefined) =>
  f.pflicht && f.vorgabe === undefined && !(f.geheim && bestand?.gesetzt.includes(f.name));

const EinstellungsFeld = (props: { f: Feld; bestand: Bestand | undefined; praefix: string }) => (
  <Show
    when={props.f.typ !== "ja_nein"}
    fallback={
      <label class="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          name={feldName(props.f.name, props.praefix)}
          checked={angehakt(props.f, props.bestand?.werte[props.f.name])}
          class={haken}
        />
        <code class="font-mono text-xs">{props.f.name}</code>
        <Show when={props.f.beschreibung}>
          <span class="text-xs text-muted-foreground">{props.f.beschreibung}</span>
        </Show>
      </label>
    }
  >
    <Input
      label={props.f.name}
      name={feldName(props.f.name, props.praefix)}
      type={EINGABE[props.f.typ as keyof typeof EINGABE]}
      step={props.f.typ === "zahl" ? "any" : undefined}
      required={noetig(props.f, props.bestand)}
      value={props.f.geheim ? "" : String(props.bestand?.werte[props.f.name] ?? "")}
      placeholder={props.f.vorgabe === undefined ? undefined : String(props.f.vorgabe)}
      autocomplete={props.f.geheim ? "new-password" : "off"}
      hint={hinweis(props.f, props.bestand)}
      class="font-mono"
    />
  </Show>
);

/** The fields of a form under a legend; nothing without fields */
export const EinstellungsFelder = (props: {
  felder: readonly Feld[];
  titel: string;
  text: string;
  bestand?: Bestand;
  /** The fields' prefix in the form (`feldName`); `env` unless the form has two levels */
  praefix?: string;
}) => (
  <Show when={props.felder.length > 0}>
    <fieldset class="grid gap-3">
      <legend class="mb-1 grid gap-0.5">
        <span class="text-xs font-medium">{props.titel}</span>
        <span class="text-xs text-muted-foreground">{props.text}</span>
      </legend>
      <For each={props.felder}>
        {(f) => <EinstellungsFeld f={f} bestand={props.bestand} praefix={props.praefix ?? "env"} />}
      </For>
    </fieldset>
  </Show>
);

import { Button, Icon, m } from "@steuerzentrale/ui";
import { CircleCheck } from "@steuerzentrale/ui/icons";
import { createSignal, createUniqueId, Match, Show, Switch } from "solid-js";
import { angehakt, type Feld, feldName } from "../daten/einstellungs-formular.ts";
import type { Bestand } from "./einstellungs-felder.tsx";

/*
 * One value of "Werte für Apps" (the approved mockup "Einstellungen"): its title in words (the
 * manifest's `titel`, else its name), "Pflicht", the setting's name small on the right, the field
 * and the description below. A secret never comes back: set, it shows as "gesetzt" with "Ändern",
 * which opens an empty field (empty keeps the value). No app is known by name.
 */

const FELD =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] placeholder:text-muted-foreground";

const EINGABE = { text: "text", zahl: "number", geheim: "password" } as const;

const istGesetzt = (f: Feld, b: Bestand) => f.geheim && b.gesetzt.includes(f.name);

/** Required unless it has a default, or it is a secret already set (empty keeps it) */
const noetig = (f: Feld, b: Bestand) => f.pflicht && f.vorgabe === undefined && !istGesetzt(f, b);

/** The description, the default, the option, and for a secret being replaced what empty means */
const hinweis = (f: Feld, neu: boolean) =>
  [
    f.beschreibung === f.titel ? undefined : f.beschreibung,
    f.vorgabe === undefined ? undefined : m.einst_vorgabe({ wert: String(f.vorgabe) }),
    f.option === undefined ? undefined : m.einst_nur_mit_option({ option: f.option }),
    neu ? m.einst_geheim_neu() : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

const Kopf = (props: { f: Feld; id: string }) => (
  <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
    <p id={`${props.id}-titel`} class="font-medium">
      <label for={props.id}>{props.f.titel}</label>
      <Show when={props.f.pflicht}>
        <span class="font-normal text-muted-foreground"> · {m.einst_pflicht()}</span>
      </Show>
    </p>
    <Show when={props.f.titel !== props.f.name}>
      <code class="font-mono text-xs text-muted-foreground">{props.f.name}</code>
    </Show>
  </div>
);

/** A secret that is set: "gesetzt" and the button that opens a field for a new one */
const Gesetzt = (props: { id: string; oeffnen: () => void }) => (
  <div class="flex items-center gap-2">
    <span class="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5">
      <Icon icon={CircleCheck} class="text-ok" />
      {m.inst_wert_gesetzt()}
    </span>
    <Button aria-describedby={`${props.id}-titel`} onClick={() => props.oeffnen()}>
      {m.einst_geheim_aendern()}
    </Button>
  </div>
);

export const WertFeld = (props: { f: Feld; bestand: Bestand }) => {
  const id = createUniqueId();
  const [neu, setNeu] = createSignal(false);
  const text = () => hinweis(props.f, neu());
  return (
    <div class="grid gap-2 border-t py-4">
      <Kopf f={props.f} id={id} />
      <Switch>
        <Match when={props.f.typ === "ja_nein"}>
          <input
            id={id}
            type="checkbox"
            name={feldName(props.f.name)}
            checked={angehakt(props.f, props.bestand.werte[props.f.name])}
            aria-describedby={text() ? `${id}-hint` : undefined}
            class="size-4 accent-[hsl(var(--primary))]"
          />
        </Match>
        <Match when={istGesetzt(props.f, props.bestand) && !neu()}>
          <Gesetzt id={id} oeffnen={() => setNeu(true)} />
        </Match>
        <Match when={true}>
          <input
            id={id}
            ref={(el) => {
              // opened with "Ändern": the field takes the focus the button had
              if (istGesetzt(props.f, props.bestand)) queueMicrotask(() => el.focus());
            }}
            name={feldName(props.f.name)}
            type={EINGABE[props.f.typ as keyof typeof EINGABE]}
            step={props.f.typ === "zahl" ? "any" : undefined}
            required={noetig(props.f, props.bestand)}
            value={props.f.geheim ? "" : String(props.bestand.werte[props.f.name] ?? "")}
            placeholder={
              props.f.vorgabe === undefined ? m.einst_nicht_gesetzt() : String(props.f.vorgabe)
            }
            autocomplete={props.f.geheim ? "new-password" : "off"}
            aria-describedby={text() ? `${id}-hint` : undefined}
            class={FELD}
          />
        </Match>
      </Switch>
      <Show when={text()}>
        <p id={`${id}-hint`} class="text-xs text-muted-foreground">
          {text()}
        </p>
      </Show>
    </div>
  );
};

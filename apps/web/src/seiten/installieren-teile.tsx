import type { Manifest, Platzierung } from "@steuerzentrale/manifest";
import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, CircleX, TriangleAlert } from "@steuerzentrale/ui/icons";
import { For, Match, Show, Switch } from "solid-js";
import type { Antwort } from "../anmeldung/api.ts";
import { grundText, installationsFehler } from "./installieren-texte.ts";

/*
 * The parts of the dialog "Installieren" that come from the manifest (BAULISTE.md Z-402; mockup
 * openInstall): the options and the placement the Zentrale answers for what is chosen; the settings
 * are in einstellungs-felder.tsx. No app is known by name.
 */

const KOPF = {
  passt: { icon: CircleCheck, farbe: "text-ok", text: () => m.platz_passt() },
  hinweise: { icon: TriangleAlert, farbe: "text-warn", text: () => m.platz_hinweise() },
  passt_nicht: { icon: CircleX, farbe: "text-destructive", text: () => m.platz_passt_nicht() },
} as const;

const Befunde = (props: { p: Platzierung; titel: string }) => {
  const kopf = () => KOPF[props.p.art];
  const befunde = () => [...("gruende" in props.p ? props.p.gruende : []), ...props.p.hinweise];
  return (
    <div class="grid gap-1.5 rounded-lg border p-3" data-testid="platzierung">
      <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Icon icon={kopf().icon} size={16} class={kopf().farbe} />
        <span class="font-medium">{kopf().text()}</span>
        <span class="text-xs text-muted-foreground">{props.titel}</span>
      </p>
      <ul class="grid gap-1 pl-6 text-xs text-muted-foreground">
        <For each={befunde()}>{(b) => <li>{grundText(b)}</li>}</For>
      </ul>
    </div>
  );
};

/** What the Zentrale says about the choice; `pruefend` while a new answer is on its way */
export const PlatzierungsBox = (props: {
  antwort: Antwort<Platzierung> | undefined;
  titel: string;
  pruefend: boolean;
}) => {
  const fehler = () => {
    const a = props.antwort;
    return a && !a.ok ? installationsFehler(a) : undefined;
  };
  const platzierung = () => {
    const a = props.antwort;
    return a?.ok ? a.daten : undefined;
  };
  return (
    <div class="grid gap-1.5">
      <p class="flex items-center justify-between gap-2 text-xs font-medium">
        {m.installieren_platzierung()}
        <Show when={props.pruefend}>
          <span class="font-normal text-muted-foreground">
            {m.installieren_platzierung_prueft()}
          </span>
        </Show>
      </p>
      <div role="status" aria-live="polite">
        <Switch
          fallback={
            <p class="text-xs text-muted-foreground">{m.installieren_platzierung_offen()}</p>
          }
        >
          <Match when={fehler()}>{(text) => <p class="text-xs text-danger">{text()}</p>}</Match>
          <Match when={platzierung()}>{(p) => <Befunde p={p()} titel={props.titel} />}</Match>
        </Switch>
      </div>
      <p class="text-xs text-muted-foreground">{m.installieren_platzierung_text()}</p>
    </div>
  );
};

const haken = "size-4 accent-[hsl(var(--primary))]";

/** The manifest's options, each a checkbox; `onWahl` with the options now chosen */
export const OptionenFelder = (props: {
  manifest: Manifest;
  gewaehlt: string[];
  onWahl: (optionen: string[]) => void;
}) => {
  const umschalten = (id: string, an: boolean) =>
    props.onWahl(an ? [...props.gewaehlt, id] : props.gewaehlt.filter((option) => option !== id));
  return (
    <Show when={props.manifest.optionen.length > 0}>
      <fieldset class="grid gap-1.5">
        <legend class="mb-1.5 text-xs font-medium">{m.installieren_optionen()}</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <For each={props.manifest.optionen}>
            {(o) => (
              <label class="flex items-center gap-2 rounded-md border p-2 text-[13px]">
                <input
                  type="checkbox"
                  value={o.id}
                  checked={props.gewaehlt.includes(o.id)}
                  onChange={(event) => umschalten(o.id, event.currentTarget.checked)}
                  class={haken}
                />
                {o.name}
              </label>
            )}
          </For>
        </div>
      </fieldset>
    </Show>
  );
};

import type { JSX } from "@solidjs/web";
import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, CircleX, type IconNode, Info, TriangleAlert } from "@steuerzentrale/ui/icons";
import { For, Show } from "solid-js";
import type { EreignisDerZentrale, Ereignisschwere } from "../daten/betrieb.ts";
import { bestand } from "../daten/quelle.ts";
import type { Schwere } from "../daten/typen.ts";
import { zeitpunkt } from "../format/zeit.ts";
import { ZielLink } from "./verweise.tsx";
import { Zustand } from "./zeichen.tsx";

/** Lists of the pages: events, check rows and key figures (DESIGN.md, "Bausteine") */

export const SCHWERE: Record<Schwere, { icon: IconNode; farbe: string; text: () => string }> = {
  krit: { icon: CircleX, farbe: "text-destructive", text: () => m.schwere_krit() },
  warn: { icon: TriangleAlert, farbe: "text-warn", text: () => m.schwere_warn() },
  info: { icon: Info, farbe: "text-muted-foreground", text: () => m.schwere_info() },
};

/** A symbol with its meaning for screen readers: colour and shape are not read aloud */
export const SchwereSymbol = (props: { schwere: Schwere; icon?: IconNode }) => (
  <span class="flex size-8 shrink-0 items-center justify-center rounded-md border">
    <Icon
      icon={props.icon ?? SCHWERE[props.schwere].icon}
      class={SCHWERE[props.schwere].farbe}
      label={SCHWERE[props.schwere].text()}
    />
  </span>
);

/** An event's severity in the symbols of the pages: an error is a fault */
export const schwereDes = (s: Ereignisschwere): Schwere =>
  s === "fehler" ? "krit" : s === "warn" ? "warn" : "info";

/** Events as the Zentrale lists them (BAULISTE.md Z-406), each with its target as a link */
export const Ereignisliste = (props: { ereignisse: EreignisDerZentrale[] }) => (
  <Show
    when={props.ereignisse.length > 0}
    fallback={<p class="text-muted-foreground">{m.ereignisse_keine()}</p>}
  >
    <ul class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <For each={props.ereignisse}>
        {(e) => (
          <li class="flex min-w-0 items-start gap-3">
            <SchwereSymbol schwere={schwereDes(e.schwere)} />
            <div class="min-w-0 flex-1">
              <p class="font-medium leading-snug">
                <ZielLink ziel={e.ziel} verweis={e.verweis} />
              </p>
              <p class="mt-0.5 break-words text-muted-foreground">{e.text}</p>
            </div>
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
              {zeitpunkt(e.zeitpunkt, bestand().jetzt)}
            </span>
          </li>
        )}
      </For>
    </ul>
  </Show>
);

/** A check: icon, name, detail, and OK or "Prüfen" (null: nothing to judge) */
export const Pruefzeile = (props: {
  icon: IconNode;
  name: string;
  detail: string;
  ok: boolean | null;
}) => (
  <div class="flex items-center gap-3 rounded-lg border p-3">
    <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent">
      <Icon icon={props.icon} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-medium leading-none">{props.name}</p>
      <p class="mt-1 text-xs break-words text-muted-foreground">{props.detail}</p>
    </div>
    <Show when={props.ok !== null}>
      <Show
        when={props.ok}
        fallback={<Zustand icon={TriangleAlert} farbe="text-warn" text={m.pruefung_pruefen()} />}
      >
        <Zustand icon={CircleCheck} farbe="text-ok" text={m.pruefung_ok()} />
      </Show>
    </Show>
  </div>
);

/**
 * A key figure of the overview: label, value, a badge, an optional small chart (teile/diagramme.tsx)
 * and two lines of explanation; with a chart the tiles of a row keep their parts on one line, as
 * in Speicherstadt/belegt (src/components/start/Ueberblick.tsx)
 */
export const Kennzahl = (props: {
  name: string;
  wert: string;
  marke: JSX.Element;
  diagramm?: JSX.Element;
  zeile1: string;
  zeile2: string;
}) => (
  <section class="flex flex-col rounded-xl border bg-linear-to-t from-primary/[0.02] to-background">
    <div class="relative flex flex-col gap-1.5 p-5 pb-0">
      <h2 class="text-muted-foreground">{props.name}</h2>
      <p class="text-2xl font-semibold tabular-nums leading-none tracking-tight lg:text-3xl">
        {props.wert}
      </p>
      <div class="absolute top-5 right-5">{props.marke}</div>
    </div>
    <Show when={props.diagramm}>
      <div class="flex min-h-8 items-center px-5 pt-4">{props.diagramm}</div>
    </Show>
    <div class="mt-auto flex flex-col gap-1.5 p-5 pt-4">
      <p class="font-medium leading-snug">{props.zeile1}</p>
      <p class="text-muted-foreground">{props.zeile2}</p>
    </div>
  </section>
);

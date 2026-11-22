import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

/** Cards, page heads and description lists (DESIGN.md, "Bausteine"; design/mockup/) */

export const Karte = (props: { class?: string | undefined; children: JSX.Element }) => (
  <section class={["min-w-0 rounded-xl border bg-background", props.class]}>
    {props.children}
  </section>
);

export const KartenKopf = (props: { titel: string; text?: string; aktion?: JSX.Element }) => (
  <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-5">
    <div class="grid min-w-0 gap-1">
      <h2 class="font-semibold leading-none">{props.titel}</h2>
      <Show when={props.text}>
        <p class="text-muted-foreground">{props.text}</p>
      </Show>
    </div>
    <Show when={props.aktion}>
      <div class="shrink-0">{props.aktion}</div>
    </Show>
  </div>
);

export const KartenInhalt = (props: { class?: string; children: JSX.Element }) => (
  <div class={["px-5 pb-5", props.class]}>{props.children}</div>
);

/** The head of a page: its title, one or two sentences, and its main action if it has one */
export const Seitenkopf = (props: { titel: string; text: string; aktion?: JSX.Element }) => (
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid min-w-0 gap-1">
      <h1 class="text-2xl font-semibold tracking-tight">{props.titel}</h1>
      <p class="max-w-3xl text-muted-foreground">{props.text}</p>
    </div>
    <Show when={props.aktion}>
      <div class="flex flex-wrap gap-2">{props.aktion}</div>
    </Show>
  </div>
);

export type Zeile = { name: string; wert: JSX.Element };

/** Name and value per row, the value right-aligned */
export const Angaben = (props: { zeilen: Zeile[] }) => (
  <dl class="grid gap-3">
    <For each={props.zeilen}>
      {(zeile) => (
        <div class="flex items-start justify-between gap-4">
          <dt class="shrink-0 text-muted-foreground">{zeile.name}</dt>
          <dd class="min-w-0 text-right font-medium break-words">{zeile.wert}</dd>
        </div>
      )}
    </For>
  </dl>
);

/** A note in a box: an icon, a title and a sentence (the mockup's Alert) */
export const Hinweisbox = (props: {
  icon: JSX.Element;
  titel: string;
  children: JSX.Element;
  ton?: "neutral" | "warn";
}) => (
  <div
    class={[
      "flex w-full items-start gap-3 rounded-lg border px-4 py-3",
      props.ton === "warn" ? "border-warn/50" : "bg-background",
    ]}
  >
    <span class={["mt-0.5", props.ton === "warn" ? "text-warn" : "text-muted-foreground"]}>
      {props.icon}
    </span>
    <div class="min-w-0 flex-1">
      <p class="mb-1 font-medium leading-none">{props.titel}</p>
      <div class="text-muted-foreground">{props.children}</div>
    </div>
  </div>
);

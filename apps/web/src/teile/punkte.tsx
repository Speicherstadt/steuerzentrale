import type { JSX } from "@solidjs/web";
import { Icon, m } from "@steuerzentrale/ui";
import { CircleCheck, type IconNode, TriangleAlert } from "@steuerzentrale/ui/icons";
import { Show } from "solid-js";
import { Zustand } from "./zeichen.tsx";

/*
 * The rows of a tab "Überblick" (the page of an app, of a server): an icon, a title, one line and
 * on the right a judgement or what to do there (docs/plan.md, "Navigation (Oberfläche 2026-11)").
 */

export const Gut = () => <Zustand icon={CircleCheck} farbe="text-ok" text={m.app_in_ordnung()} />;

const Pruefen = () => (
  <Zustand icon={TriangleAlert} farbe="text-warn" text={m.pruefung_pruefen()} />
);

/** A mark for a judgement: in order, to look at, or nothing to judge */
export const Urteil = (props: { ok: boolean | null }) => (
  <Show when={props.ok !== null}>
    <Show when={props.ok} fallback={<Pruefen />}>
      <Gut />
    </Show>
  </Show>
);

/** One row: icon, title, one line, and on the right a mark or what to do */
export const Punkt = (props: {
  icon: IconNode;
  titel: string;
  text: string;
  testid: string;
  rechts?: JSX.Element;
}) => (
  <li class="flex flex-wrap items-center gap-3 py-3.5 sm:flex-nowrap" data-testid={props.testid}>
    <span class="flex size-8 shrink-0 items-center justify-center rounded-md border">
      <Icon icon={props.icon} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-medium">{props.titel}</p>
      <p class="break-words text-muted-foreground">{props.text}</p>
    </div>
    <Show when={props.rechts}>
      <div class="ml-11 shrink-0 sm:ml-0">{props.rechts}</div>
    </Show>
  </li>
);

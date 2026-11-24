import { For, Show } from "solid-js";

/**
 * A row of toggle buttons where one is pressed, for filters and views (the mockup's tabs over a
 * table): each button says with aria-pressed whether it is chosen
 */
export const Schalter = <T extends string>(props: {
  name: string;
  wahl: { wert: T; name: string; anzahl?: number }[];
  aktuell: T;
  onWahl: (wert: T) => void;
}) => (
  <fieldset class="inline-flex h-9 max-w-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] rounded-lg border bg-muted p-1">
    <legend class="sr-only">{props.name}</legend>
    <For each={props.wahl}>
      {(w) => (
        <button
          type="button"
          aria-pressed={props.aktuell === w.wert ? "true" : "false"}
          class={[
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium whitespace-nowrap",
            props.aktuell === w.wert
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ]}
          onClick={() => props.onWahl(w.wert)}
        >
          {w.name}
          <Show when={w.anzahl !== undefined}>
            <span class="text-xs tabular-nums">{w.anzahl}</span>
          </Show>
        </button>
      )}
    </For>
  </fieldset>
);

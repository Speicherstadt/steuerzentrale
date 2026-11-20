import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

/*
 * A table (DESIGN.md: head in `muted`, rows hover). On a phone it scrolls sideways; the scroll box is
 * focusable and named so a keyboard reaches what lies off screen (axe: scrollable-region-focusable).
 */

export type Spalte = { name: string; class?: string };

export const Tabelle = (props: {
  name: string;
  spalten: Spalte[];
  minBreite: number;
  leer: string;
  anzahl: number;
  children: JSX.Element;
  rahmen?: boolean;
}) => (
  <section
    aria-label={props.name}
    tabindex="0"
    class={[
      // inline-size containment: the wide table scrolls here instead of widening the page
      "overflow-x-auto [contain:inline-size] focus-visible:outline-offset-[-2px]",
      props.rahmen !== false && "rounded-lg border",
    ]}
  >
    <table class="w-full" style={{ "min-width": `${props.minBreite}px` }}>
      <thead class="bg-muted">
        <tr class="border-b">
          <For each={props.spalten}>
            {(spalte) => (
              <th
                scope="col"
                class={[
                  "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4",
                  spalte.class,
                ]}
              >
                {spalte.name}
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody class="[&_tr:last-child]:border-0">
        <Show
          when={props.anzahl > 0}
          fallback={
            <tr>
              <td colspan={props.spalten.length} class="h-20 text-center text-muted-foreground">
                {props.leer}
              </td>
            </tr>
          }
        >
          {props.children}
        </Show>
      </tbody>
    </table>
  </section>
);

/** A row; its cells get the table's padding */
export const Reihe = (props: { class?: string; children: JSX.Element }) => (
  <tr
    class={[
      "border-b align-top transition-colors hover:bg-muted [&>td]:p-2 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4",
      props.class,
    ]}
  >
    {props.children}
  </tr>
);

/** A grey row between groups, such as the server above its installations */
export const Zwischenzeile = (props: { spalten: number; children: JSX.Element }) => (
  <tr class="border-b bg-muted">
    <td colspan={props.spalten} class="p-2 pl-4">
      {props.children}
    </td>
  </tr>
);

/**
 * A list to choose from, such as the entries (WAI-ARIA listbox): one stop in the tab order, arrows,
 * Home and End move the selection, the focused option is named by aria-activedescendant.
 */
import type { JSX } from "@solidjs/web";
import { createUniqueId, For } from "solid-js";
import { ariaBoolean } from "../lib/aria.ts";
import { cn } from "../lib/cn.ts";
import { nextIndex } from "../lib/keys.ts";

/**
 * What an option shows before and after its text is rendered by a function: `items` is read again
 * by the handlers, and elements made there would have no owner and be made anew on every read
 */
export type ListItem = {
  id: string;
  label: string;
  description?: string;
  leading?: () => JSX.Element;
  trailing?: (() => JSX.Element) | undefined;
};
export type ListProps = {
  label: string;
  items: ListItem[];
  selected?: string | undefined;
  onSelect: (id: string) => void;
};

export const optionId = (base: string, id: string) => `${base}-${id}`;

export const List = (props: ListProps) => {
  const base = createUniqueId();
  const selectedIndex = () => props.items.findIndex((item) => item.id === props.selected);
  const onKeyDown = (event: KeyboardEvent) => {
    const next = nextIndex(event.key, selectedIndex(), props.items.length);
    if (next === undefined) return;
    event.preventDefault();
    const item = props.items[next];
    if (item) props.onSelect(item.id);
    document.getElementById(optionId(base, item?.id ?? ""))?.scrollIntoView?.({ block: "nearest" });
  };
  return (
    // biome-ignore lint/a11y/useAriaActivedescendantWithTabindex: Biome looks for React's tabIndex; Solid writes the attribute tabindex, which is set here
    <div
      role="listbox"
      aria-label={props.label}
      tabindex={0}
      // Only an option that is shown can be active: a filtered list may hide the selected one
      aria-activedescendant={
        selectedIndex() >= 0 ? optionId(base, props.selected ?? "") : undefined
      }
      class="grid gap-0.5 rounded-lg p-1 focus-visible:outline-2"
      onKeyDown={onKeyDown}
      onClick={(event) => {
        // One handler for all options: the listbox takes the keys, the options only show the choice
        const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
        const item = props.items.find((entry) => optionId(base, entry.id) === option?.id);
        if (item) props.onSelect(item.id);
      }}
    >
      <For each={props.items}>
        {(item) => (
          // biome-ignore lint/a11y/useFocusableInteractive: Biome looks for React's tabIndex; Solid writes the attribute tabindex, which is set here
          <div
            role="option"
            tabindex={-1}
            id={optionId(base, item.id)}
            aria-selected={ariaBoolean(item.id === props.selected)}
            class={cn(
              "flex cursor-default items-center gap-2.5 rounded-md p-2",
              item.id === props.selected ? "bg-accent" : "hover:bg-accent/60",
            )}
          >
            {item.leading?.()}
            <div class="grid min-w-0 flex-1">
              <span class="truncate text-[13px] font-medium">{item.label}</span>
              {item.description && (
                <span
                  class={cn(
                    "truncate text-xs",
                    // On the accent surface the muted grey falls below 4.5:1 (DESIGN.md, Farben)
                    item.id === props.selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.description}
                </span>
              )}
            </div>
            {item.trailing?.()}
          </div>
        )}
      </For>
    </div>
  );
};

/**
 * Tabs (WAI-ARIA APG, automatic activation): one tab in the tab order, left and right arrows,
 * Home and End move and show the tab's panel.
 */
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createUniqueId, For } from "solid-js";
import { ariaBoolean } from "../lib/aria.ts";
import { cn } from "../lib/cn.ts";
import { nextIndex } from "../lib/keys.ts";

export type Tab = { id: string; label: string; content: () => JSX.Element };
export type TabsProps = {
  label: string;
  tabs: Tab[];
  initial?: string;
  onChange?: (id: string) => void;
};

export const Tabs = (props: TabsProps) => {
  const base = createUniqueId();
  // Seeded from the props and set by the user; a new initial tab from the parent starts over. The
  // memo passes on only another ID, so new labels or contents keep the tab the user chose
  const seed = createMemo(() => props.initial ?? props.tabs[0]?.id ?? "");
  const [current, setCurrent] = createSignal(() => seed());
  // By the tab's ID, which a ref can read without tracking; the row's index is an accessor
  const buttons = new Map<string, HTMLButtonElement>();
  const choose = (index: number) => {
    const tab = props.tabs[index];
    if (!tab) return;
    setCurrent(tab.id);
    buttons.get(tab.id)?.focus();
    props.onChange?.(tab.id);
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const next = nextIndex(event.key, index, props.tabs.length, "horizontal");
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
  };
  return (
    <div class="grid gap-3">
      <div
        role="tablist"
        aria-label={props.label}
        class="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted p-1"
      >
        <For each={props.tabs}>
          {(tab, index) => (
            <button
              ref={(el) => {
                buttons.set(tab.id, el);
              }}
              type="button"
              role="tab"
              id={`${base}-${tab.id}-tab`}
              aria-selected={ariaBoolean(current() === tab.id)}
              aria-controls={`${base}-${tab.id}-panel`}
              tabindex={current() === tab.id ? 0 : -1}
              class={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium",
                current() === tab.id ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
              onClick={() => choose(index())}
              onKeyDown={(event) => onKeyDown(event, index())}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <For each={props.tabs}>
        {(tab) => (
          <div
            role="tabpanel"
            id={`${base}-${tab.id}-panel`}
            aria-labelledby={`${base}-${tab.id}-tab`}
            tabindex="0"
            hidden={current() !== tab.id}
          >
            {current() === tab.id && tab.content()}
          </div>
        )}
      </For>
    </div>
  );
};

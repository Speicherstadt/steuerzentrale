/**
 * A menu button (WAI-ARIA APG): opens on click, Enter or Space with the first item focused; arrows,
 * Home and End move, Enter chooses, Esc and Tab close and give the focus back to the button.
 */

import type { JSX } from "@solidjs/web";
import type { IconNode } from "lucide";
import { createUniqueId, For } from "solid-js";
import { cn } from "../lib/cn.ts";
import { nextIndex } from "../lib/keys.ts";
import { anchoredBelow, anchorName } from "./anchor.ts";
import { buttonClass } from "./button.tsx";
import { Icon } from "./icon.tsx";
import { floatingClass } from "./popover.tsx";

export type MenuItem = { label: string; icon?: IconNode; danger?: boolean; onSelect: () => void };
export type MenuProps = { trigger: JSX.Element; label?: string; items: MenuItem[] };

export const Menu = (props: MenuProps) => {
  const id = createUniqueId();
  let menu: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const close = () => {
    menu?.hidePopover();
    button?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") return close();
    const list = items();
    const next = nextIndex(
      event.key,
      list.indexOf(document.activeElement as HTMLElement),
      list.length,
    );
    if (next === undefined) return;
    event.preventDefault();
    list[next]?.focus();
  };
  return (
    <>
      <button
        ref={(el) => {
          button = el;
        }}
        type="button"
        popovertarget={id}
        aria-haspopup="menu"
        aria-controls={id}
        aria-label={props.label}
        class={buttonClass()}
        style={anchorName(id)}
      >
        {props.trigger}
      </button>
      <div
        id={id}
        ref={(el) => {
          menu = el;
        }}
        popover="auto"
        role="menu"
        aria-label={props.label}
        class={cn(floatingClass, "min-w-44")}
        style={anchoredBelow(id)}
        onToggle={(event) => {
          if ((event as ToggleEvent).newState === "open") items()[0]?.focus();
        }}
        onKeyDown={onKeyDown}
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent focus:bg-accent focus:outline-none",
                item.danger && "text-danger",
              )}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon && <Icon icon={item.icon} />}
              {item.label}
            </button>
          )}
        </For>
      </div>
    </>
  );
};

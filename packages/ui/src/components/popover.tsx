/** A popover on the Popover API: light dismiss and Esc come from the browser, the position from CSS anchors */
import type { JSX } from "@solidjs/web";
import { createUniqueId } from "solid-js";
import { cn } from "../lib/cn.ts";
import { anchoredBelow, anchorName } from "./anchor.ts";
import { buttonClass } from "./button.tsx";

export const floatingClass =
  "rounded-xl border border-border bg-background p-1 text-foreground shadow-lg";

export type PopoverProps = {
  /** What the trigger shows; an icon-only trigger needs `label` */
  trigger: JSX.Element;
  label?: string;
  children: JSX.Element;
  class?: string;
};

export const Popover = (props: PopoverProps) => {
  const id = createUniqueId();
  return (
    <>
      <button
        type="button"
        popovertarget={id}
        aria-label={props.label}
        class={buttonClass()}
        style={anchorName(id)}
      >
        {props.trigger}
      </button>
      <div
        id={id}
        popover="auto"
        class={cn(floatingClass, "p-3", props.class)}
        style={anchoredBelow(id)}
      >
        {props.children}
      </div>
    </>
  );
};

/**
 * A tooltip (WAI-ARIA APG): shown on hover and keyboard focus, hidden on Esc, on leaving and on
 * blur; the trigger points to it with aria-describedby. A manual popover, so it never steals focus.
 */
import type { JSX } from "@solidjs/web";
import { createUniqueId, onSettled } from "solid-js";
import { anchoredBelow, anchorName } from "./anchor.ts";

export type TriggerAttributes = {
  "aria-describedby": string;
  style: Record<string, string>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

export type TooltipProps = {
  text: string;
  /** Renders the trigger with the attributes it must carry */
  children: (trigger: TriggerAttributes) => JSX.Element;
};

export const Tooltip = (props: TooltipProps) => {
  const id = createUniqueId();
  let tip: HTMLDivElement | undefined;
  let leaving: ReturnType<typeof setTimeout> | undefined;
  // Esc closes it wherever the focus is, also when it opened by hover (WCAG 1.4.13)
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };
  const show = () => {
    clearTimeout(leaving);
    if (tip?.matches(":popover-open")) return;
    tip?.showPopover();
    document.addEventListener("keydown", onEscape);
  };
  const hide = () => {
    clearTimeout(leaving);
    document.removeEventListener("keydown", onEscape);
    if (tip?.matches(":popover-open")) tip.hidePopover();
  };
  // Leaving the trigger towards the tooltip keeps it open: the pointer may rest on it (WCAG 1.4.13)
  const leave = () => {
    leaving = setTimeout(hide, 150);
  };
  // Leaving the page while shown drops the Esc listener and the timer with it
  onSettled(() => hide);
  return (
    <>
      {props.children({
        "aria-describedby": id,
        style: anchorName(id),
        onPointerEnter: show,
        onPointerLeave: leave,
        onFocus: show,
        onBlur: hide,
        onKeyDown: (event) => {
          if (event.key === "Escape") hide();
        },
      })}
      <div
        id={id}
        ref={(el) => {
          tip = el;
        }}
        onPointerEnter={show}
        onPointerLeave={leave}
        popover="manual"
        role="tooltip"
        class="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-md"
        style={anchoredBelow(id)}
      >
        {props.text}
      </div>
    </>
  );
};

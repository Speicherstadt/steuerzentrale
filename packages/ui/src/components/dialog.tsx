/** A modal dialog on <dialog> with showModal(): the browser traps the focus and closes on Esc */

import type { JSX } from "@solidjs/web";
import { X } from "lucide";
import { createEffect, createUniqueId } from "solid-js";
import { m } from "../paraglide/messages.js";
import { IconButton } from "./button.tsx";
import { Icon } from "./icon.tsx";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: JSX.Element;
};

const candidates = "a[href], button, input, select, textarea, [tabindex]";

/**
 * What Tab can reach: in the tab order, not disabled, rendered (not hidden, not in a closed
 * popover, not display:none) and not inert (review of K-301)
 */
const tabbable = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(candidates)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.hasAttribute("disabled") &&
      !el.closest("[hidden], [inert]") &&
      el.checkVisibility(),
  );

/**
 * Tab and Shift+Tab wrap around inside the dialog (WAI-ARIA APG): showModal() makes the page
 * inert, but Chromium still lets the focus leave to the browser's own controls
 */
const wrapFocus = (event: KeyboardEvent, dialog: HTMLElement) => {
  if (event.key !== "Tab") return;
  const items = tabbable(dialog);
  const first = items[0];
  const last = items.at(-1);
  const edge = event.shiftKey ? first : last;
  if (document.activeElement !== edge) return;
  event.preventDefault();
  (event.shiftKey ? last : first)?.focus();
};

export const Dialog = (props: DialogProps) => {
  const id = createUniqueId();
  let dialog: HTMLDialogElement | undefined;
  createEffect(
    () => props.open,
    (open) => {
      if (open && !dialog?.open) dialog?.showModal();
      if (!open && dialog?.open) dialog.close();
    },
  );
  return (
    <dialog
      ref={(el) => {
        dialog = el;
      }}
      aria-labelledby={`${id}-title`}
      aria-describedby={props.description ? `${id}-description` : undefined}
      onClose={() => props.onClose()}
      onKeyDown={(event) => wrapFocus(event, event.currentTarget)}
      class="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <div class="flex items-start justify-between gap-4 p-4 pb-2">
        <div class="grid gap-1">
          <h2 id={`${id}-title`} class="text-[15px] font-semibold">
            {props.title}
          </h2>
          {props.description && (
            <p id={`${id}-description`} class="text-xs text-muted-foreground">
              {props.description}
            </p>
          )}
        </div>
        <IconButton label={m.ui_close()} onClick={() => props.onClose()}>
          <Icon icon={X} />
        </IconButton>
      </div>
      <div class="px-4 pb-4">{props.children}</div>
    </dialog>
  );
};

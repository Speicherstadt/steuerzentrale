/** Text fields with a visible label (DESIGN.md), and the search with magnifier and shortcut */

import type { JSX } from "@solidjs/web";
import { Search } from "lucide";
import { createUniqueId, omit, onSettled, Show } from "solid-js";
import { m } from "../paraglide/messages.js";
import { Icon } from "./icon.tsx";

const fieldClass =
  "h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] placeholder:text-muted-foreground disabled:opacity-50";

export type InputProps = JSX.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string | undefined;
};

export const Input = (props: InputProps) => {
  const id = createUniqueId();
  return (
    <div class="grid gap-1.5">
      <label for={id} class="text-xs font-medium">
        {props.label}
      </label>
      <input
        id={id}
        {...omit(props, "label", "hint", "class")}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
        class={[fieldClass, props.class]}
      />
      <Show when={props.hint}>
        <p id={`${id}-hint`} class="text-xs text-muted-foreground">
          {props.hint}
        </p>
      </Show>
    </div>
  );
};

export type TextAreaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string };

/** Long text (a note, an address, a key) with a visible label, like Input */
export const TextArea = (props: TextAreaProps) => {
  const id = createUniqueId();
  return (
    <div class="grid gap-1.5">
      <label for={id} class="text-xs font-medium">
        {props.label}
      </label>
      <textarea
        id={id}
        rows={4}
        {...omit(props, "label", "class")}
        class={[fieldClass, "h-auto min-h-20 py-1.5", props.class]}
      />
    </div>
  );
};

/** Typing the shortcut anywhere outside a field focuses the search, as "/" does in the list */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export const SearchInput = (props: Omit<InputProps, "hint" | "type"> & { shortcut?: string }) => {
  const id = createUniqueId();
  let input: HTMLInputElement | undefined;
  const onKey = (event: KeyboardEvent) => {
    if (!props.shortcut || event.key !== props.shortcut || isTyping(event.target)) return;
    event.preventDefault();
    input?.focus();
  };
  // On the whole page while the field is on screen, and gone with it
  onSettled(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <div class="relative">
      <label for={id} class="sr-only">
        {props.label}
      </label>
      <Icon
        icon={Search}
        class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        id={id}
        ref={(el) => {
          input = el;
        }}
        type="search"
        {...omit(props, "label", "shortcut", "class")}
        aria-keyshortcuts={props.shortcut}
        class={[fieldClass, "pl-8", props.shortcut && "pr-8", props.class]}
      />
      <Show when={props.shortcut}>
        {(key) => (
          <kbd
            class="absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1 font-mono text-[11px] text-muted-foreground"
            title={m.ui_search_shortcut({ key: key() })}
          >
            {key()}
          </kbd>
        )}
      </Show>
    </div>
  );
};

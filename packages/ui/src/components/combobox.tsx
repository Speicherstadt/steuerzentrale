/**
 * A combobox (WAI-ARIA APG, list autocomplete): typing filters the options, arrows move through
 * them, Enter takes one, Esc closes the list or, when closed, clears the field. The list is a
 * manual popover under the field.
 */
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { ariaBoolean } from "../lib/aria.ts";
import { cn } from "../lib/cn.ts";
import { nextIndex } from "../lib/keys.ts";
import { m } from "../paraglide/messages.js";
import { anchoredBelow, anchorName } from "./anchor.ts";
import { floatingClass } from "./popover.tsx";

export type ComboboxProps = {
  label: string;
  options: string[];
  value?: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

/** The options that contain the text, ignoring case; all of them for an empty field */
export const matching = (options: string[], text: string) =>
  options.filter((option) => option.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()));

export const Combobox = (props: ComboboxProps) => {
  const id = createUniqueId();
  const [text, setText] = createSignal(props.value ?? "");
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const shown = createMemo(() => matching(props.options, text()));
  let list: HTMLDivElement | undefined;
  const setShown = (visible: boolean) => {
    if (!visible) setActive(-1);
    if (visible === open()) return;
    setOpen(visible);
    if (visible) list?.showPopover();
    else list?.hidePopover();
  };
  const take = (option: string) => {
    setText(option);
    setShown(false);
    props.onChange(option);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return open() ? setShown(false) : setText("");
    }
    const chosen = shown()[active()];
    if (event.key === "Enter" && open() && chosen !== undefined) {
      event.preventDefault();
      return take(chosen);
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setShown(true);
    setActive(nextIndex(event.key, active(), shown().length) ?? -1);
  };
  const optionId = (index: number) => `${id}-option-${index}`;
  return (
    <div class="grid gap-1.5">
      <label for={id} class="text-xs font-medium">
        {props.label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={ariaBoolean(open())}
        aria-controls={`${id}-list`}
        aria-activedescendant={active() >= 0 ? optionId(active()) : undefined}
        autocomplete="off"
        placeholder={props.placeholder}
        value={text()}
        class="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] placeholder:text-muted-foreground"
        style={anchorName(id)}
        onInput={(event) => {
          setText(event.currentTarget.value);
          setActive(-1);
          setShown(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setShown(false)}
      />
      <div
        ref={(el) => {
          list = el;
        }}
        popover="manual"
        class={cn(floatingClass, "max-h-60 min-w-56 overflow-auto")}
        style={anchoredBelow(id)}
      >
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={props.label}
          onPointerDown={(event) => {
            // Keep the focus in the field; the option under the pointer is taken
            event.preventDefault();
            const index = Number(
              (event.target as Element).closest("[data-index]")?.getAttribute("data-index"),
            );
            const option = shown()[index];
            if (option !== undefined) take(option);
          }}
        >
          <For each={shown()}>
            {(option, index) => (
              // biome-ignore lint/a11y/useFocusableInteractive: Biome looks for React's tabIndex; Solid writes the attribute tabindex, which is set here
              <div
                role="option"
                tabindex={-1}
                id={optionId(index())}
                data-index={index()}
                aria-selected={ariaBoolean(index() === active())}
                class={cn(
                  "rounded-md px-2 py-1.5 text-[13px]",
                  index() === active() && "bg-accent",
                )}
              >
                {option}
              </div>
            )}
          </For>
        </div>
        {/* Outside the listbox, which may hold only options (review of K-301) */}
        <Show when={shown().length === 0}>
          <p role="status" class="px-2 py-1.5 text-[13px] text-muted-foreground">
            {m.ui_no_matches()}
          </p>
        </Show>
      </div>
    </div>
  );
};

/**
 * Short messages in a polite live region (DESIGN.md): each disappears after a while, but not while
 * the pointer or the focus is inside the region, so nobody loses a message they are reading.
 */
import { X } from "lucide";
import { createSignal, For } from "solid-js";
import { cn } from "../lib/cn.ts";
import { m } from "../paraglide/messages.js";
import { IconButton } from "./button.tsx";
import { Icon } from "./icon.tsx";

export type Toast = { id: number; text: string; tone?: "neutral" | "success" | "danger" };

export const TOAST_MS = 5000;

export const createToasts = (schedule: typeof setTimeout = setTimeout) => {
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  let next = 0;
  let held = false;
  const dismiss = (id: number) => setToasts((list) => list.filter((toast) => toast.id !== id));
  const expire = (id: number) => {
    if (held) schedule(() => expire(id), TOAST_MS);
    else dismiss(id);
  };
  return {
    toasts,
    dismiss,
    show: (text: string, tone: Toast["tone"] = "neutral") => {
      const id = next++;
      setToasts((list) => [...list, { id, text, tone }]);
      schedule(() => expire(id), TOAST_MS);
      return id;
    },
    /** While true, nothing expires; expiry is tried again a full interval later */
    hold: (value: boolean) => {
      held = value;
    },
  };
};

export type Toasts = ReturnType<typeof createToasts>;

export const Toaster = (props: { toasts: Toasts }) => (
  <section
    aria-label={m.ui_notifications()}
    class="pointer-events-none fixed right-4 bottom-4 z-50 grid w-80 gap-2"
    onPointerEnter={() => props.toasts.hold(true)}
    onPointerLeave={() => props.toasts.hold(false)}
    onFocusIn={() => props.toasts.hold(true)}
    onFocusOut={() => props.toasts.hold(false)}
  >
    <div role="status" aria-live="polite" class="grid gap-2">
      <For each={props.toasts.toasts()}>
        {(toast) => (
          <div
            class={cn(
              "pointer-events-auto flex items-start gap-2 rounded-xl border border-border bg-background p-3 text-[13px] shadow-lg",
              toast.tone === "success" && "text-success",
              toast.tone === "danger" && "text-danger",
            )}
          >
            <p class="flex-1 text-foreground">{toast.text}</p>
            <IconButton label={m.ui_close()} onClick={() => props.toasts.dismiss(toast.id)}>
              <Icon icon={X} />
            </IconButton>
          </div>
        )}
      </For>
    </div>
  </section>
);

/** Badges (DESIGN.md): "ändern" in the warning colour, counters grey, "geprüft" green */
import type { JSX } from "@solidjs/web";
import { cn } from "../lib/cn.ts";
import { variants } from "../lib/variants.ts";

const badgeClass = variants(
  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none",
  {
    tone: {
      neutral: "bg-accent text-muted-foreground",
      warning: "bg-warning-surface text-warning",
      success: "bg-accent text-success",
      danger: "bg-accent text-danger",
    },
  },
  { tone: "neutral" },
);

export type BadgeProps = {
  tone?: "neutral" | "warning" | "success" | "danger";
  class?: string;
  children: JSX.Element;
};

export const Badge = (props: BadgeProps) => (
  <span class={cn(badgeClass({ tone: props.tone }), props.class)}>{props.children}</span>
);

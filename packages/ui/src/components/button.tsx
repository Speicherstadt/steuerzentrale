/** Buttons (DESIGN.md): one primary per view, the rest outline, ghost or icon; icon buttons carry an aria-label */
import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";
import { variants } from "../lib/variants.ts";

export const buttonClass = variants(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variant: {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      outline: "border border-border bg-background hover:bg-accent",
      ghost: "hover:bg-accent",
      danger: "bg-danger text-white hover:bg-danger/90",
    },
    size: { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3 text-[13px]", icon: "size-8" },
  },
  { variant: "outline", size: "md" },
);

type Groups = Parameters<typeof buttonClass>[0];
export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & NonNullable<Groups>;

export const Button = (props: ButtonProps) => (
  <button
    type="button"
    {...omit(props, "variant", "size", "class")}
    class={[buttonClass({ variant: props.variant, size: props.size }), props.class]}
  />
);

/** A button with only an icon: the label is required, as screen readers read nothing else */
export const IconButton = (props: Omit<ButtonProps, "size"> & { label: string }) => (
  <Button
    {...omit(props, "label")}
    size="icon"
    variant={props.variant ?? "ghost"}
    aria-label={props.label}
  />
);

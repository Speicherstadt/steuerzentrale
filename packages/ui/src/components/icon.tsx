/**
 * An icon from lucide (the framework-free icon data; lucide-solid needs Solid 1). Decorative
 * unless it has a label; a button with only an icon gets its own aria-label (DESIGN.md).
 */

import { dynamic } from "@solidjs/web";
import type { IconNode } from "lucide";
import { For } from "solid-js";

/** One path, circle or line of the icon, created in the SVG namespace */
const Shape = (props: { tag: string; attrs: Record<string, string | number | undefined> }) => {
  const Tag = dynamic(() => props.tag, { static: true });
  return <Tag xmlns="http://www.w3.org/2000/svg" {...props.attrs} />;
};

export type IconProps = { icon: IconNode; size?: number; label?: string; class?: string };

export const Icon = (props: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={props.size ?? 16}
    height={props.size ?? 16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
    role={props.label ? "img" : undefined}
    aria-label={props.label}
    aria-hidden={props.label ? undefined : "true"}
  >
    <For each={props.icon}>{([tag, attrs]) => <Shape tag={tag} attrs={attrs} />}</For>
  </svg>
);

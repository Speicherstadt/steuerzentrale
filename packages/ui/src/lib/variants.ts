/**
 * Picks the classes of a component's variants, typed: each prop names one option of its group, an
 * omitted prop takes the default. Components separate states with data-* attributes instead of
 * overriding classes (DESIGN.md, Komponenten).
 */
import { cn } from "./cn.ts";

type Groups = Record<string, Record<string, string>>;
export type VariantProps<G extends Groups> = { [K in keyof G]?: keyof G[K] | undefined };

export const variants =
  <G extends Groups>(base: string, groups: G, defaults: { [K in keyof G]: keyof G[K] }) =>
  (props: VariantProps<G> = {}) =>
    cn(
      base,
      ...Object.entries(groups).map(
        ([group, options]) => options[String(props[group] ?? defaults[group])],
      ),
    );

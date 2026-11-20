/**
 * Where the focus goes on a key, for menus, lists, comboboxes and tabs (WAI-ARIA Authoring
 * Practices): arrows step and wrap around, Home and End jump. Undefined: the key is not ours.
 */
export type Orientation = "vertical" | "horizontal";

const steps: Record<Orientation, Record<string, number>> = {
  vertical: { ArrowDown: 1, ArrowUp: -1 },
  horizontal: { ArrowRight: 1, ArrowLeft: -1 },
};

export const nextIndex = (
  key: string,
  current: number,
  count: number,
  orientation: Orientation = "vertical",
): number | undefined => {
  if (count === 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = steps[orientation][key];
  if (step === undefined) return undefined;
  // Nothing chosen yet: down starts at the top, up at the bottom
  if (current < 0) return step > 0 ? 0 : count - 1;
  return (current + step + count) % count;
};

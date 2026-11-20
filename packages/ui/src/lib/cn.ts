/** Class names joined, falsy parts left out: `cn("row", selected && "row-selected")` */
export const cn = (...parts: (string | false | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part)).join(" ");

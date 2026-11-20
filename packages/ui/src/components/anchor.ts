/**
 * CSS anchor positioning for popovers, menus and tooltips: the floating part sits under its
 * trigger and flips above when there is no room (DESIGN.md, Komponenten)
 */
export const anchorName = (id: string) => ({ "anchor-name": `--${id}` });

export const anchoredBelow = (id: string) => ({
  "position-anchor": `--${id}`,
  top: "anchor(bottom)",
  left: "anchor(left)",
  "margin-top": "4px",
  "position-try-fallbacks": "flip-block, flip-inline",
});

/**
 * A bucket of `vorrat` refilled with one every `nachschubMs`: whether one more may pass at `jetzt`.
 * A clock that jumped back refills nothing.
 */
export const eimer = (vorrat: number, nachschubMs: number): ((jetzt: number) => boolean) => {
  let stand = { vorrat, am: Number.NEGATIVE_INFINITY };
  return (jetzt) => {
    const nachschub = stand.am === Number.NEGATIVE_INFINITY ? 0 : jetzt - stand.am;
    const voll = Math.min(vorrat, stand.vorrat + Math.max(0, nachschub) / nachschubMs);
    const erlaubt = voll >= 1;
    stand = { vorrat: erlaubt ? voll - 1 : voll, am: jetzt };
    return erlaubt;
  };
};

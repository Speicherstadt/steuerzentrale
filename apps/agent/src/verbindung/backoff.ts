/*
 * When the agent tries again after its connection ended (BAULISTE.md Z-303): exponential backoff
 * from one second up to five minutes, with "equal jitter" (half the wait fixed, half random), so a
 * Zentrale that restarts is not met by all its agents in the same second, and none waits longer
 * than the cap.
 */
export const BACKOFF_ANFANG_MS = 1000;
export const BACKOFF_HOECHSTENS_MS = 5 * 60_000;

/** The wait before attempt `versuch` (0 for the first retry); `zufall` in [0, 1) */
export const wartezeit = (versuch: number, zufall: number): number => {
  const grenze = Math.min(BACKOFF_HOECHSTENS_MS, BACKOFF_ANFANG_MS * 2 ** Math.min(versuch, 30));
  return Math.round(grenze / 2 + (grenze / 2) * zufall);
};

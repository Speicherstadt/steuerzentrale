import type { Planer } from "../aufbewahrung/index.ts";

/*
 * A check that runs every `ms` and at once when pushed (DNS records, Z-407; S3 accesses, Z-601):
 * never two runs at a time, a push during a run makes one more after it; a run that throws is
 * handed to `fehlgeschlagen` and the next one comes as planned.
 */
export const anstossbareSchleife = (
  lauf: () => Promise<unknown>,
  planen: Planer,
  ms: number,
  fehlgeschlagen: (fehler: unknown) => void,
): { anstossen: () => void } => {
  let laeuft = false;
  let nochmal = false;
  const runde = async (): Promise<void> => {
    if (laeuft) {
      nochmal = true;
      return;
    }
    laeuft = true;
    try {
      do {
        nochmal = false;
        await lauf();
      } while (nochmal);
    } catch (fehler) {
      fehlgeschlagen(fehler);
    } finally {
      laeuft = false;
    }
  };
  planen(() => void runde(), ms);
  return { anstossen: () => void runde() };
};

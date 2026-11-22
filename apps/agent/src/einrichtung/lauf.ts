import type { SystemDeps } from "./typen.ts";
import { gelungen, gescheitert, type Schrittergebnis } from "./typen.ts";

/*
 * One fixed argv of setting up or tearing down, as a result with the step's name instead of an
 * exception: killed when its own time limit or the job's runs out (the job's signal), its exit code
 * the verdict. Output is dropped (log excerpts come with Z-405), so no value written to a standard
 * input can come back in a result.
 */

export type LaufOptionen = { eingabe?: string; zeitlimitMs?: number };

export type Lauf = (
  schritt: string,
  argv: readonly string[],
  o?: LaufOptionen,
) => Promise<Schrittergebnis>;

const kurz = (text: string) => text.slice(0, 500);

export const laeufer =
  (deps: Pick<SystemDeps, "spawn" | "planen">, auftrag?: AbortSignal): Lauf =>
  async (schritt, argv, o = {}) => {
    const ueberschritten = () => gescheitert(`${schritt}: Zeitlimit des Auftrags überschritten`);
    if (auftrag?.aborted) return ueberschritten();
    const eigen = new AbortController();
    let abgelaufen = false;
    const aufheben =
      o.zeitlimitMs === undefined
        ? () => {}
        : deps.planen(() => {
            abgelaufen = true;
            eigen.abort();
          }, o.zeitlimitMs);
    const signal = auftrag ? AbortSignal.any([auftrag, eigen.signal]) : eigen.signal;
    try {
      const { code } = await deps.spawn(argv, signal, o.eingabe);
      if (auftrag?.aborted) return ueberschritten();
      if (abgelaufen)
        return gescheitert(
          `${schritt}: Zeitlimit von ${(o.zeitlimitMs ?? 0) / 1000} s überschritten`,
        );
      return code === 0 ? gelungen : gescheitert(`${schritt}: endete mit Code ${code ?? "–"}`);
    } catch (fehler) {
      return gescheitert(kurz(`${schritt}: startete nicht: ${String(fehler)}`));
    } finally {
      aufheben();
    }
  };

/** Asks until the answer is yes, `versuche` times with `ms` between; false when it never was */
export const bisJa = async (
  deps: Pick<SystemDeps, "warten">,
  versuche: number,
  ms: number,
  frage: () => Promise<boolean>,
  auftrag?: AbortSignal,
): Promise<boolean> => {
  for (let i = 0; i < versuche; i++) {
    if (await frage()) return true;
    if (auftrag?.aborted) return false;
    await deps.warten(ms);
  }
  return false;
};

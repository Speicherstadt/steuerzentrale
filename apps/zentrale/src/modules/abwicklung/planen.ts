import type { Planer } from "../aufbewahrung/index.ts";
import { anstossbareSchleife } from "../schleife/index.ts";
import { beendeteOhneAbwicklung, offeneAbwicklungen } from "./lesen.ts";
import { type AbwicklungDeps, beginnen, schrittAusfuehren } from "./schritte.ts";

/*
 * The loop after contracts ended (BAULISTE.md Z-604; docs/plan.md, "Kündigung und Löschung"): every
 * 30 seconds, and at once when pushed (a notice given or taken back, a job's end), first the
 * running installations whose contract just ended, then each row at its step, one after the other.
 */

export const ABWICKLUNG_MS = 30_000;

/** One round; returns how many rows it looked at */
export const abwicklungRunde = async (deps: AbwicklungDeps): Promise<number> => {
  const jetzt = deps.now();
  for (const b of beendeteOhneAbwicklung(deps.db, jetzt)) beginnen(deps, b, jetzt);
  const offen = offeneAbwicklungen(deps.db);
  for (const a of offen) await schrittAusfuehren(deps, a, deps.now());
  return offen.length;
};

export const abwicklungSchleife = (
  deps: AbwicklungDeps,
  planen: Planer,
): { anstossen: () => void } =>
  anstossbareSchleife(
    () => abwicklungRunde(deps),
    planen,
    ABWICKLUNG_MS,
    (fehler) =>
      deps.log(JSON.stringify({ msg: "contract end check failed", fehler: String(fehler) })),
  );

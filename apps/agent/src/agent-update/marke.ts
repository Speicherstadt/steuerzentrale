import { z } from "zod";
import type { Binaer, Dateien } from "../dateien.ts";

/*
 * The mark of an update of the agent (BAULISTE.md Z-504; docs/plan.md, "Rückkehr zum alten
 * Agenten"): written by the old agent before it puts the new binary in place, confirmed by the new
 * one once its Zentrale greeted it (`willkommen`), read by the old binary when its check runs
 * (rueckkehr.ts). Without the confirmation the old binary goes back into place.
 */

export const Marke = z.object({
  auftragId: z.string().min(1),
  vorher: z.string().min(1),
  neu: z.string().min(1),
  am: z.number().int().nonnegative(),
  bestaetigt: z.boolean(),
});
export type Marke = z.infer<typeof Marke>;

export const markeLesen = async (dateien: Dateien, pfad: string): Promise<Marke | undefined> => {
  const text = await dateien.lesen(pfad);
  if (text === undefined) return undefined;
  try {
    const m = Marke.safeParse(JSON.parse(text));
    return m.success ? m.data : undefined;
  } catch {
    return undefined;
  }
};

export const markeSchreiben = (dateien: Dateien, pfad: string, m: Marke): Promise<void> =>
  dateien.schreiben(pfad, `${JSON.stringify(m)}\n`, 0o600);

export type BestaetigenDeps = {
  dateien: Dateien;
  binaer: Binaer;
  pfad: string;
  /** This agent's version */
  version: string;
  log: (msg: string, mehr?: Record<string, unknown>) => void;
};

/**
 * Called at each `willkommen`: an update to this version that waits for its confirmation gets it.
 * A mark of another version (unreadable, or left by an update this binary is not) is removed, so a
 * later check finds nothing to undo.
 */
export const updateBestaetigen = async (deps: BestaetigenDeps): Promise<void> => {
  const text = await deps.dateien.lesen(deps.pfad);
  if (text === undefined) return;
  const m = await markeLesen(deps.dateien, deps.pfad);
  if (!m || m.neu !== deps.version) {
    await deps.binaer.loeschen(deps.pfad);
    return;
  }
  if (m.bestaetigt) return;
  await markeSchreiben(deps.dateien, deps.pfad, { ...m, bestaetigt: true });
  deps.log("agent update confirmed", { vorher: m.vorher, version: m.neu });
};

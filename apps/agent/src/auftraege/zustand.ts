import { z } from "zod";
import type { Dateien } from "../dateien.ts";

/*
 * The agent's own record of its jobs (BAULISTE.md Z-305), a JSON file written atomically: a job is
 * marked `laeuft` before its argv starts and `fertig` with its result before the result is sent.
 * So a job sent twice is answered from here instead of run again, and a job that was running when
 * the agent stopped is known as such after the restart. Finished jobs are forgotten after 30 days:
 * the Zentrale sends a job again only while it has no result for it.
 */

const ergebnis = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), daten: z.record(z.string(), z.unknown()) }),
  z.object({ ok: z.literal(false), fehler: z.string() }),
]);

const eintrag = z.discriminatedUnion("zustand", [
  z.object({ zustand: z.literal("laeuft"), am: z.number() }),
  z.object({ zustand: z.literal("fertig"), am: z.number(), ergebnis }),
]);

const Datei = z.object({ auftraege: z.record(z.string(), eintrag) });

export type Eintrag = z.output<typeof eintrag>;
export type Stand = Map<string, Eintrag>;

/** How long a finished job is remembered */
export const VERGESSEN_NACH_MS = 30 * 24 * 3600_000;

export type Geladen = { ok: true; stand: Stand } | { ok: false; grund: string };

/** The record, empty when there is none yet; an unreadable one is an error, never an empty record */
export const standLaden = async (dateien: Dateien, pfad: string): Promise<Geladen> => {
  const text = await dateien.lesen(pfad);
  if (text === undefined) return { ok: true, stand: new Map() };
  try {
    const geparst = Datei.safeParse(JSON.parse(text));
    if (geparst.success)
      return { ok: true, stand: new Map(Object.entries(geparst.data.auftraege)) };
  } catch {
    // not JSON: the same answer as a wrong shape
  }
  return { ok: false, grund: `${pfad} is not the agent's record of jobs` };
};

/** The record as written: finished jobs older than VERGESSEN_NACH_MS left out */
export const standText = (stand: Stand, jetzt: number): string =>
  JSON.stringify({
    auftraege: Object.fromEntries(
      [...stand].filter(([, e]) => e.zustand === "laeuft" || jetzt - e.am < VERGESSEN_NACH_MS),
    ),
  });

/** Writes the record, one write after the other, each atomically (rename into place) */
export const standSchreiber = (dateien: Dateien, pfad: string, jetzt: () => number) => {
  let zuletzt: Promise<void> = Promise.resolve();
  return (stand: Stand): Promise<void> => {
    const text = standText(stand, jetzt());
    zuletzt = zuletzt.catch(() => {}).then(() => dateien.schreiben(pfad, text, 0o600));
    return zuletzt;
  };
};

import type { Gedaechtnis } from "../einrichtung/gedaechtnis.ts";
import { type NutzerLesen, nutzerName } from "../einrichtung/nutzer.ts";
import { lastMesser } from "./last.ts";
import { type FaktenNachricht, faktenLesen } from "./lesen.ts";
import type { FaktenQuellen } from "./quellen.ts";

/*
 * The facts the agent reports, with CPU, load and memory (BAULISTE.md Z-1106): of the server and of
 * the Linux user of every installation in its record, whose uid it reads from the system. One
 * reader for the agent's life, so each report's CPU covers the time since the one before.
 */
export const faktenMitLast = (q: FaktenQuellen, gedaechtnis: Gedaechtnis, nutzer: NutzerLesen) => {
  const messen = lastMesser(q);
  const nutzerDerInstallationen = async () => {
    const g = await gedaechtnis.lesen();
    if (!g.ok) return [];
    const gefunden = await Promise.all([...g.stand.keys()].map((i) => nutzer(nutzerName(i))));
    return gefunden.flatMap((n) => (n ? [{ name: n.name, uid: n.uid }] : []));
  };
  return async (uhrzeitAbweichungMs: number | null, jetzt: number): Promise<FaktenNachricht> => {
    const fakten = await faktenLesen(q, { jetzt, uhrzeitAbweichungMs });
    const last = await messen(await nutzerDerInstallationen(), fakten.cpuKerne, jetzt);
    return { ...fakten, last };
  };
};

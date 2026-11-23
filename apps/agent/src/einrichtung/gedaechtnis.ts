import { z } from "zod";
import type { Dateien } from "../dateien.ts";
import { PruefZiel } from "../zustand/ziel.ts";

/*
 * The agent's own record of the installations it made (docs/plan.md, "Scheitern beim Einrichten"):
 * /var/lib/steuerzentrale/installationen.json, 0600, written atomically, one write after the other,
 * like its record of jobs (src/auftraege/zustand.ts). An installation is `angelegt` before useradd
 * runs and `fertig` once its setup went through; a failed setup that was torn down is forgotten.
 * Only a user named here is one the agent made: any other `sz-<name>` it never touches. An
 * unreadable record is an error, never an empty one: an empty record would make the agent take its
 * own installations for someone else's, or worse, the other way round after a repair.
 */

/**
 * What the health check of a finished installation needs (Z-403, src/zustand), rendered from its
 * signed manifest at setup: its units and the target of the check. An entry from before Z-403 has
 * none and is reported unknown, never green
 */
const pruefung = z.object({ units: z.array(z.string().min(1)), ziel: PruefZiel });

/**
 * The names of the settings whose values a log excerpt replaces (Z-405, typ `geheim` and ebene
 * `auto`), from the signed manifest at setup and reconfiguring: names only, the values stay in the
 * units and in Podman. An entry from before Z-405 has none (src/aktionen/geheimnisse.ts)
 */
const geheim = z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/));

const eintrag = z.object({
  zustand: z.enum(["angelegt", "fertig"]),
  am: z.number(),
  pruefung: pruefung.optional(),
  geheim: geheim.optional(),
});
const Datei = z.object({ installationen: z.record(z.string(), eintrag) });

export type Pruefung = z.output<typeof pruefung>;
export type InstallationsEintrag = z.output<typeof eintrag>;
export type InstallationsStand = ReadonlyMap<string, InstallationsEintrag>;

export type GedaechtnisGelesen =
  | { ok: true; stand: InstallationsStand }
  | { ok: false; grund: string };

export type Gedaechtnis = {
  lesen: () => Promise<GedaechtnisGelesen>;
  /**
   * Records the installation's state, with what its health check needs and the names of its secret
   * settings once it is `fertig`, or forgets it with undefined; throws when it cannot
   */
  setzen: (
    name: string,
    zustand: InstallationsEintrag["zustand"] | undefined,
    pruefung?: Pruefung,
    geheim?: readonly string[],
  ) => Promise<void>;
};

const laden = async (dateien: Dateien, pfad: string): Promise<GedaechtnisGelesen> => {
  const text = await dateien.lesen(pfad);
  if (text === undefined) return { ok: true, stand: new Map() };
  try {
    const geparst = Datei.safeParse(JSON.parse(text));
    if (geparst.success)
      return { ok: true, stand: new Map(Object.entries(geparst.data.installationen)) };
  } catch {
    // not JSON: the same answer as a wrong shape
  }
  return { ok: false, grund: `${pfad} is not the agent's record of installations` };
};

export const gedaechtnisOeffnen = (
  dateien: Dateien,
  pfad: string,
  jetzt: () => number,
): Gedaechtnis => {
  let geladen: Promise<GedaechtnisGelesen> | undefined;
  let zuletzt: Promise<void> = Promise.resolve();

  const lesen = async (): Promise<GedaechtnisGelesen> => {
    geladen ??= laden(dateien, pfad);
    const g = await geladen;
    // read again next time: a repaired record counts without a restart
    if (!g.ok) geladen = undefined;
    return g;
  };

  const setzen: Gedaechtnis["setzen"] = async (name, zustand, pruefung, geheim) => {
    const g = await lesen();
    if (!g.ok) throw new Error(g.grund);
    const stand = new Map(g.stand);
    if (zustand === undefined) stand.delete(name);
    else
      stand.set(name, {
        zustand,
        am: jetzt(),
        ...(pruefung ? { pruefung } : {}),
        ...(geheim ? { geheim: [...geheim] } : {}),
      });
    geladen = Promise.resolve({ ok: true, stand });
    const text = JSON.stringify({ installationen: Object.fromEntries(stand) });
    zuletzt = zuletzt.catch(() => {}).then(() => dateien.schreiben(pfad, text, 0o600));
    return zuletzt;
  };

  return { lesen, setzen };
};

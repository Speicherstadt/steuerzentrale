import { alsNutzer, homeVon, type Nutzer } from "../einrichtung/nutzer.ts";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";
import { type Lauf, standDateiPfad, standLesen } from "./datei.ts";

/*
 * The agent (root) reads an installation's backup-stand.json as that user (BAULISTE.md Z-601): the
 * file is the user's to write, so reading it as the user means a symlink in its home reaches
 * nothing the user could not read itself, never another installation's file. The output is cut at
 * 64 KiB (zustand/echt.ts); 14 runs are far below. Only what passes the schema counts.
 */

const LESEN_MS = 10_000;

/** The runs in the installation's stand file, oldest first; undefined when there is none */
export const laeufeLesen = async (
  deps: { lesen: SpawnMitAusgabe },
  n: Nutzer,
  installation: string,
  signal?: AbortSignal,
): Promise<Lauf[] | undefined> => {
  const zeit = AbortSignal.timeout(LESEN_MS);
  const r = await deps
    .lesen(
      alsNutzer(n, ["cat", "--", standDateiPfad(homeVon(installation))]),
      signal ? AbortSignal.any([signal, zeit]) : zeit,
    )
    .catch(() => undefined);
  return r?.code === 0 ? standLesen(r.aus) : undefined;
};

/** The newest run that ended at or after `seit` */
export const neuesterLauf = async (
  deps: { lesen: SpawnMitAusgabe },
  n: Nutzer,
  installation: string,
  seit: number,
  signal?: AbortSignal,
): Promise<Lauf | undefined> =>
  (await laeufeLesen(deps, n, installation, signal))?.filter((l) => l.ende >= seit).at(-1);

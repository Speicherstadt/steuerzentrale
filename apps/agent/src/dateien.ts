import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The file system as the agent uses it, passed in so the logic can be tested without one */
export type Dateien = {
  lesen: (pfad: string) => Promise<string | undefined>;
  /** Writes atomically (a temporary file renamed into place) with the given mode */
  schreiben: (pfad: string, inhalt: string, modus: number) => Promise<void>;
  /** Moves a file into place in one step (rename(2) within one file system) */
  umbenennen: (von: string, nach: string) => Promise<void>;
};

/** Files as bytes: the agent's own binary and its update (src/agent-update, Z-504) */
export type Binaer = {
  lesen: (pfad: string) => Promise<Uint8Array | undefined>;
  /** Writes atomically (a temporary file renamed into place) with the given mode */
  schreiben: (pfad: string, inhalt: Uint8Array, modus: number) => Promise<void>;
  /** Removes a file; one that is missing is no error */
  loeschen: (pfad: string) => Promise<void>;
};

export const echtesBinaer: Binaer = {
  lesen: async (pfad) => {
    try {
      return new Uint8Array(await readFile(pfad));
    } catch {
      return undefined;
    }
  },
  schreiben: async (pfad, inhalt, modus) => {
    const neu = `${pfad}.schreiben`;
    await writeFile(neu, inhalt, { mode: modus });
    await chmod(neu, modus);
    await rename(neu, pfad);
  },
  loeschen: (pfad) => rm(pfad, { force: true }),
};

export const echteDateien: Dateien = {
  lesen: (pfad) => readFile(pfad, "utf8").catch(() => undefined),
  schreiben: async (pfad, inhalt, modus) => {
    await mkdir(dirname(pfad), { recursive: true, mode: 0o755 });
    const neu = `${pfad}.neu`;
    await writeFile(neu, inhalt, { mode: modus });
    // writeFile keeps the mode of a file that already existed
    await chmod(neu, modus);
    await rename(neu, pfad);
  },
  umbenennen: (von, nach) => rename(von, nach),
};

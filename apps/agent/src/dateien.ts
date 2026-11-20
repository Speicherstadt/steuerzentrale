import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The file system as the agent uses it, passed in so the logic can be tested without one */
export type Dateien = {
  lesen: (pfad: string) => Promise<string | undefined>;
  /** Writes atomically (a temporary file renamed into place) with the given mode */
  schreiben: (pfad: string, inhalt: string, modus: number) => Promise<void>;
  /** Moves a file into place in one step (rename(2) within one file system) */
  umbenennen: (von: string, nach: string) => Promise<void>;
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

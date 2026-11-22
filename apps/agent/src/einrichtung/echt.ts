import { constants } from "node:fs";
import {
  chmod,
  lchown,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type { HausDateien } from "./haus.ts";

/*
 * The real file system for writing into a user's home as root (haus.ts). The home belongs to the
 * user, so nothing in it is followed blindly: a folder that is a symlink is refused, a file is
 * written new (O_EXCL, which never follows a symlink) next to its place and renamed over it, and
 * the owner is set with lchown.
 */

const istDa = async (pfad: string) =>
  lstat(pfad).then(
    () => true,
    () => false,
  );

export const echteHausDateien: HausDateien = {
  lesen: (pfad) => readFile(pfad, "utf8").catch(() => undefined),
  dateiLesen: async (pfad) => {
    // O_NOFOLLOW: a symlink in the user's home fails with ELOOP instead of being read as root
    const datei = await open(pfad, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      (fehler: NodeJS.ErrnoException) => {
        if (fehler.code === "ENOENT") return undefined;
        throw new Error(`${pfad} cannot be read: ${fehler.code ?? "error"}`);
      },
    );
    if (datei === undefined) return undefined;
    try {
      if (!(await datei.stat()).isFile()) throw new Error(`${pfad} is not a regular file`);
      return await datei.readFile("utf8");
    } finally {
      await datei.close();
    }
  },
  existiert: istDa,
  verzeichnis: async (pfad, modus, { uid, gid }) => {
    const art = await lstat(pfad).catch(() => undefined);
    if (art === undefined) await mkdir(pfad, { mode: modus });
    else if (!art.isDirectory()) throw new Error(`${pfad} is not a folder`);
    await chmod(pfad, modus);
    await lchown(pfad, uid, gid);
  },
  schreiben: async (pfad, inhalt, modus, { uid, gid }) => {
    const neu = `${pfad}.sz-neu`;
    await rm(neu, { force: true });
    await writeFile(neu, inhalt, { mode: modus, flag: "wx" });
    // the umask may have taken bits off the mode
    await chmod(neu, modus);
    await lchown(neu, uid, gid);
    await rename(neu, pfad);
  },
};

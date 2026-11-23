import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lchown,
  lstat,
  mkdir,
  open,
  readdir,
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
    // another job may make the same folder at the same moment (the Pforte's): EEXIST is no error,
    // but what is there is looked at again
    await mkdir(pfad, { mode: modus }).catch((fehler: NodeJS.ErrnoException) => {
      if (fehler.code !== "EEXIST") throw fehler;
    });
    if (!(await lstat(pfad)).isDirectory()) throw new Error(`${pfad} is not a folder`);
    await chmod(pfad, modus);
    await lchown(pfad, uid, gid);
  },
  schreiben: async (pfad, inhalt, modus, { uid, gid }) => {
    // a name of its own: another job may write the same file at the same moment (the Pforte's unit)
    const neu = `${pfad}.sz-neu-${randomUUID()}`;
    try {
      await writeFile(neu, inhalt, { mode: modus, flag: "wx" });
      // the umask may have taken bits off the mode
      await chmod(neu, modus);
      await lchown(neu, uid, gid);
      await rename(neu, pfad);
    } catch (fehler) {
      await rm(neu, { force: true });
      throw fehler;
    }
  },
  dateienIn: async (ordner) => {
    const art = await lstat(ordner).catch(() => undefined);
    if (art === undefined) return [];
    if (!art.isDirectory()) throw new Error(`${ordner} is not a folder`);
    return (await readdir(ordner)).sort();
  },
  // without `recursive`, a folder is refused; a symlink is removed, never followed
  entfernen: (pfad) => rm(pfad, { force: true }),
};

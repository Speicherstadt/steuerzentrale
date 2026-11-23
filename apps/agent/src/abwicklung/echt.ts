import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { echtRestic } from "../backup/echt.ts";
import { echteDateien } from "../dateien.ts";
import type { ArchivDeps } from "./archivieren.ts";

/*
 * `archivieren` for real, as the installation's user (BAULISTE.md Z-604): its files in a folder of
 * its own home (0700; a dump can be larger than the runtime directory's tmpfs), the upload with
 * Bun's fetch and the file as its body, so Content-Length is the file's size.
 */

const ORDNER = ".cache/steuerzentrale/archiv";

export const echtesArchiv = (): ArchivDeps => ({
  uid: () => process.getuid?.() ?? 0,
  home: homedir,
  dateien: echteDateien,
  restic: echtRestic(),
  jetzt: Date.now,
  ordner: async () => {
    const pfad = `${homedir()}/${ORDNER}`;
    await mkdir(pfad, { recursive: true, mode: 0o700 });
    return pfad;
  },
  groesse: async (pfad) => (await stat(pfad)).size,
  hochladen: async (url, pfad, koepfe) =>
    (await fetch(url, { method: "PUT", headers: koepfe, body: Bun.file(pfad), redirect: "error" }))
      .status,
  entfernen: (pfad) => rm(pfad, { force: true }),
});

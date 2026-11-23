import type { Db, SchreibDb } from "../db/oeffnen.ts";
import { manifestImportieren } from "../modules/manifeste/index.ts";
import { signiert, TEST_SCHLUESSEL, type Testmanifest } from "./installationen.ts";

/*
 * For the tests of imported manifests (Z-501): the test manifests (testhilfen/manifeste/, signed
 * with the public test key) imported into a test database as the interface would, so an
 * installation can be made from them. The versions of probe besides 1.0.0: 1.1.0, 1.2.0 (urgent),
 * 1.10.0, the pre-release 2.0.0-rc.1 and 2.0.0 (with its image in the repository probe2).
 */

export type ProbeVersion = "1.1.0" | "1.2.0" | "1.10.0" | "2.0.0-rc.1" | "2.0.0";

export const probeVersion = (version: ProbeVersion) => signiert(`probe-${version}`);

/** Imports signed manifests for operator `betreiberId`, which must exist; throws on a refusal */
export const manifesteImportieren = (
  d: { db: Db; schreibDb: SchreibDb },
  betreiberId: string,
  jetzt: number,
  ...eingaben: { manifest: string; signatur: string }[]
): void => {
  for (const eingabe of eingaben) {
    const r = manifestImportieren(
      d,
      { betreiberId, akteur: "test", jetzt, grund: "Test" },
      TEST_SCHLUESSEL,
      eingabe,
      "betreiber",
    );
    if (!r.ok) throw new Error(`${r.grund} ${r.detail ?? ""}`);
  }
};

/** Imports the named test manifests (`probe` when none is named) */
export const testmanifesteImportieren = (
  d: { db: Db; schreibDb: SchreibDb },
  betreiberId: string,
  jetzt: number,
  ...namen: Testmanifest[]
): void =>
  manifesteImportieren(
    d,
    betreiberId,
    jetzt,
    ...(namen.length > 0 ? namen : (["probe"] as const)).map(signiert),
  );

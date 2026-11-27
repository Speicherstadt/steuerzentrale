import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { schluesselAus } from "../modules/geheim/verschluesseln.ts";
import { oeffneDatenbank } from "./oeffnen.ts";
import type { Schluesselbund } from "./schluessel.ts";

/**
 * A fresh, migrated database in a temporary file for the running test (skill checks: SQLite in a
 * temporary file, never real data); removed after the test. From Speicherstadt/soll.
 */
/** A fixed key for tests only (publicly known, never a real installation's) */
export const testSchluessel = (fuellung = 7) => {
  const geparst = schluesselAus(Buffer.alloc(32, fuellung).toString("base64"));
  if (!geparst.ok) throw new Error("test key");
  return geparst.schluessel;
};

/** Removed after the running test, or with `aufraeumen` (afterAll) for one shared by a file */
export const testDatenbank = (
  bund: Schluesselbund = { aktuell: testSchluessel(), alt: [] },
  aufraeumen: (fn: () => void) => void = onTestFinished,
) => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-db-"));
  const pfad = join(ordner, "zentrale.db");
  const offen = oeffneDatenbank(pfad, 0, bund);
  aufraeumen(() => {
    offen.schliessen();
    rmSync(ordner, { recursive: true, force: true });
  });
  return { ...offen, pfad, ordner };
};

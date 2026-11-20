import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { oeffneDatenbank } from "./oeffnen.ts";

/**
 * A fresh, migrated database in a temporary file for the running test (CLAUDE.md: SQLite in a temporary
 * file, never real data); removed after the test. From Speicherstadt/soll.
 */
export const testDatenbank = () => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-db-"));
  const pfad = join(ordner, "zentrale.db");
  const offen = oeffneDatenbank(pfad, 0);
  onTestFinished(() => {
    offen.schliessen();
    rmSync(ordner, { recursive: true, force: true });
  });
  return { ...offen, pfad, ordner };
};

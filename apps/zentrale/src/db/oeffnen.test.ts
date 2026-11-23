import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { oeffneDatenbank } from "./oeffnen.ts";
import { testSchluessel } from "./test-db.ts";

// Another process holds the database for a moment: in operation the running Zentrale while
// `steuerzentrale sichern` opens it (Z-1002), in CI the test's own connection as it closes. Holding
// it with locking_mode EXCLUSIVE blocks even a reader of the write-ahead log
// (sqlite.org/pragma.html#pragma_locking_mode), as a connection's closing checkpoint does briefly.
const HALTEN = `
import { Database } from "bun:sqlite";
const db = new Database(process.argv[1]);
db.run("PRAGMA locking_mode = EXCLUSIVE");
db.run("BEGIN EXCLUSIVE");
db.run("COMMIT");
console.log("held");
await Bun.sleep(400);
db.close();
`;

const gehalten = async (pfad: string) => {
  const kind = Bun.spawn(["bun", "-e", HALTEN, pfad], { stdout: "pipe" });
  const leser = kind.stdout.getReader();
  const { value } = await leser.read();
  expect(new TextDecoder().decode(value)).toContain("held");
  return kind;
};

describe("opening the database", () => {
  it("waits for another process that holds it for a moment instead of refusing", async () => {
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-oeffnen-"));
    onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
    const pfad = join(ordner, "zentrale.db");
    const bund = { aktuell: testSchluessel(), alt: [] };
    oeffneDatenbank(pfad, 1, bund).schliessen();
    const kind = await gehalten(pfad);
    const offen = oeffneDatenbank(pfad, 2, bund);
    offen.schliessen();
    expect(await kind.exited).toBe(0);
  }, 20_000);
});

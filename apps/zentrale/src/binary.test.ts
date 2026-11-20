import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The compiled binary carries its migrations: started in an empty data directory it creates the
// database (Z-102), and it refuses to start on a database whose applied migration was changed
const ordner = mkdtempSync(join(tmpdir(), "sz-test-binary-"));
const binary = join(ordner, "steuerzentrale");
const target = process.arch === "arm64" ? "linux-arm64" : "linux-x64";

beforeAll(() => {
  const entry = join(import.meta.dirname, "main.ts");
  const build = Bun.spawnSync([
    "bun",
    "build",
    "--compile",
    `--target=bun-${target}`,
    entry,
    "--outfile",
    binary,
  ]);
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
}, 120_000);
afterAll(() => rmSync(ordner, { recursive: true, force: true }));

const warteAuf = async (url: string): Promise<Response> => {
  for (let versuch = 0; versuch < 100; versuch++) {
    try {
      return await fetch(url);
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error(`${url} did not answer`);
};

describe("the compiled Zentrale", () => {
  it("creates its database in an empty data directory and answers /health", async () => {
    const daten = join(ordner, "leer", "daten");
    const port = 28390;
    const prozess = Bun.spawn([binary], {
      env: { STEUERZENTRALE_PORT: String(port), STEUERZENTRALE_DATA: daten },
      stdout: "pipe",
    });
    try {
      expect((await warteAuf(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      const sqlite = new Database(join(daten, "zentrale.db"), { readonly: true });
      const tabellen = sqlite
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      expect(tabellen.map((t) => t.name)).toEqual(
        expect.arrayContaining(["betreiber", "audit_log"]),
      );
      sqlite.close();
    } finally {
      prozess.kill();
      await prozess.exited;
    }
  }, 30_000);

  it("refuses to start when an applied migration was changed", async () => {
    const daten = join(ordner, "geaendert");
    const erster = Bun.spawn([binary], {
      env: { STEUERZENTRALE_PORT: "28391", STEUERZENTRALE_DATA: daten },
    });
    await warteAuf("http://127.0.0.1:28391/health");
    erster.kill();
    await erster.exited;
    const sqlite = new Database(join(daten, "zentrale.db"));
    sqlite.run("UPDATE zentrale_migrationen SET hash = 'anders'");
    sqlite.close();
    const zweiter = Bun.spawn([binary], {
      env: { STEUERZENTRALE_PORT: "28392", STEUERZENTRALE_DATA: daten },
      stderr: "pipe",
    });
    expect(await zweiter.exited).toBe(1);
    expect(await new Response(zweiter.stderr).text()).toContain("was changed after it was applied");
    expect(existsSync(join(daten, "zentrale.db"))).toBe(true);
  }, 30_000);
});

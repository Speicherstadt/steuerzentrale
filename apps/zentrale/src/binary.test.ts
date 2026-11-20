import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The compiled binary carries its migrations: started in an empty data directory it creates the
// database (Z-102), and it refuses to start on a database whose applied migration was changed
const ordner = mkdtempSync(join(tmpdir(), "sz-test-binary-"));
const binary = join(ordner, "steuerzentrale");
const KEY = Buffer.alloc(32, 7).toString("base64");
// The interface's address (here never reached): Better Auth's origin and the passkeys' domain
const URL_ = "http://localhost:28300";
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
      env: {
        STEUERZENTRALE_PORT: String(port),
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
      },
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
      env: {
        STEUERZENTRALE_PORT: "28391",
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
      },
    });
    await warteAuf("http://127.0.0.1:28391/health");
    erster.kill();
    await erster.exited;
    const sqlite = new Database(join(daten, "zentrale.db"));
    sqlite.run("UPDATE zentrale_migrationen SET hash = 'anders'");
    sqlite.close();
    const zweiter = Bun.spawn([binary], {
      env: {
        STEUERZENTRALE_PORT: "28392",
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
      },
      stderr: "pipe",
    });
    expect(await zweiter.exited).toBe(1);
    expect(await new Response(zweiter.stderr).text()).toContain("was changed after it was applied");
    expect(existsSync(join(daten, "zentrale.db"))).toBe(true);
  }, 30_000);

  it("refuses to start without a key, and with a key that does not open the database", async () => {
    const daten = join(ordner, "schluessel");
    const ohne = Bun.spawn([binary], {
      env: { STEUERZENTRALE_PORT: "28393", STEUERZENTRALE_DATA: daten, STEUERZENTRALE_URL: URL_ },
      stderr: "pipe",
    });
    expect(await ohne.exited).toBe(1);
    expect(await new Response(ohne.stderr).text()).toContain(
      "STEUERZENTRALE_SECRET_KEY is missing",
    );

    const erster = Bun.spawn([binary], {
      env: {
        STEUERZENTRALE_PORT: "28394",
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
      },
    });
    await warteAuf("http://127.0.0.1:28394/health");
    erster.kill();
    await erster.exited;
    const falsch = Buffer.alloc(32, 9).toString("base64");
    const zweiter = Bun.spawn([binary], {
      env: {
        STEUERZENTRALE_PORT: "28395",
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: falsch,
        STEUERZENTRALE_URL: URL_,
      },
      stderr: "pipe",
    });
    expect(await zweiter.exited).toBe(1);
    const meldung = await new Response(zweiter.stderr).text();
    expect(meldung).toContain("does not open this database");
    expect(meldung).not.toContain(falsch);
  }, 30_000);

  it("rotates the key on command, after which only the new key opens the database", async () => {
    const daten = join(ordner, "rotieren");
    const erster = Bun.spawn([binary], {
      env: {
        STEUERZENTRALE_PORT: "28396",
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
      },
    });
    await warteAuf("http://127.0.0.1:28396/health");
    erster.kill();
    await erster.exited;
    const neu = Buffer.alloc(32, 9).toString("base64");
    const rotation = Bun.spawn([binary, "schluessel-rotieren"], {
      env: {
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: neu,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_SECRET_KEY_ALT: KEY,
      },
      stdout: "pipe",
    });
    expect(await rotation.exited).toBe(0);
    expect(await new Response(rotation.stdout).text()).toContain("key rotated");
    const alt = Bun.spawn([binary], {
      env: {
        STEUERZENTRALE_PORT: "28397",
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
      },
    });
    expect(await alt.exited).toBe(1);
  }, 30_000);

  it("refuses to start without the address of the interface", async () => {
    const ohne = Bun.spawn([binary], {
      env: {
        STEUERZENTRALE_PORT: "28398",
        STEUERZENTRALE_DATA: join(ordner, "ohne-url"),
        STEUERZENTRALE_SECRET_KEY: KEY,
      },
      stderr: "pipe",
    });
    expect(await ohne.exited).toBe(1);
    expect(await new Response(ohne.stderr).text()).toContain("STEUERZENTRALE_URL is missing");
  }, 30_000);

  it("writes the setup code once to the log, and the first owner comes in with it", async () => {
    const daten = join(ordner, "einrichtung");
    const env = {
      STEUERZENTRALE_PORT: "28399",
      STEUERZENTRALE_DATA: daten,
      STEUERZENTRALE_SECRET_KEY: KEY,
      STEUERZENTRALE_URL: URL_,
    };
    const prozess = Bun.spawn([binary], { env, stdout: "pipe" });
    try {
      await warteAuf("http://127.0.0.1:28399/health");
      const zeilen = await zeilenBis(prozess.stdout, "setup code");
      const codes = zeilen.filter((z) => z.includes("setup code"));
      expect(codes).toHaveLength(1);
      const { code } = JSON.parse(codes[0] ?? "{}") as { code: string };
      const antwort = await fetch("http://127.0.0.1:28399/api/v1/erster-inhaber", {
        method: "POST",
        headers: { "content-type": "application/json", origin: URL_ },
        body: JSON.stringify({
          code,
          betreiber: "Teufel IT",
          name: "Ines Inhaber",
          email: "ines@betreiber.test",
          passwort: "lang-genug-und-geheim-1",
        }),
      });
      expect(antwort.status).toBe(201);
      expect(antwort.headers.getSetCookie().join(";")).toContain("session_token");
    } finally {
      prozess.kill();
      await prozess.exited;
    }
    // with an owner, a further start writes no code
    const zweiter = Bun.spawn([binary], { env, stdout: "pipe" });
    await warteAuf("http://127.0.0.1:28399/health");
    zweiter.kill();
    await zweiter.exited;
    expect(await new Response(zweiter.stdout).text()).not.toContain("setup code");
  }, 30_000);
});

/** The lines a process wrote until one contains `bis` */
const zeilenBis = async (strom: ReadableStream<Uint8Array>, bis: string): Promise<string[]> => {
  const leser = strom.getReader();
  let text = "";
  while (!text.includes(bis)) {
    const { value, done } = await leser.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  leser.releaseLock();
  return text.split("\n").filter((zeile) => zeile.trim() !== "");
};

import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The example app outside a container, as its image runs it (Containerfile: bun /app/server.ts)
const daten = mkdtempSync(join(tmpdir(), "sz-test-beispiel-app-"));
const prozesse: { kill: () => void }[] = [];
afterAll(() => {
  for (const p of prozesse) p.kill();
  rmSync(daten, { recursive: true, force: true });
});

const SERVER = join(import.meta.dirname, "server.ts");
const env = (extra: Record<string, string>) => ({
  ...process.env,
  BEISPIEL_DATEN: daten,
  BEISPIEL_VERSION: "1.0.0",
  ...extra,
});

const starten = async (http: number, tcp: number, extra: Record<string, string> = {}) => {
  prozesse.push(
    Bun.spawn(["bun", SERVER], {
      env: env({ BEISPIEL_HTTP_PORT: String(http), BEISPIEL_TCP_PORT: String(tcp), ...extra }),
    }),
  );
  for (let i = 0; i < 100; i++) {
    try {
      return await fetch(`http://127.0.0.1:${http}/health`);
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("example app did not start");
};

describe("the example app", () => {
  it("answers health, keeps entries in SQLite and shows the client address it was given", async () => {
    expect((await starten(28481, 28482)).status).toBe(200);
    expect(
      (
        await fetch("http://127.0.0.1:28481/eintraege", {
          method: "POST",
          body: JSON.stringify({ text: "erster" }),
        })
      ).status,
    ).toBe(201);
    const stand = (await (await fetch("http://127.0.0.1:28481/")).json()) as {
      version: string;
      eintraege: unknown[];
    };
    expect(stand).toMatchObject({
      version: "1.0.0",
      titel: "Beispiel",
      eintraege: [{ text: "erster", version: "1.0.0" }],
    });
    const anfrage = await fetch("http://127.0.0.1:28481/anfrage", {
      headers: { "X-Forwarded-For": "198.51.100.7" },
    });
    expect(await anfrage.json()).toMatchObject({ xForwardedFor: "198.51.100.7" });
  });

  it("echoes on its TCP port", async () => {
    const antwort = await new Promise<string>((fertig, fehler) => {
      Bun.connect({
        hostname: "127.0.0.1",
        port: 28482,
        socket: {
          open: (s) => void s.write("hallo"),
          data: (s, d) => {
            fertig(Buffer.from(d).toString());
            s.end();
          },
          error: (_s, e) => fehler(e),
        },
      }).catch(fehler);
    });
    expect(antwort).toBe("hallo");
  });

  it("exports its entries and migrates as named commands", () => {
    const exportiert = Bun.spawnSync(["bun", SERVER, "export"], { env: env({}) });
    expect(JSON.parse(exportiert.stdout.toString())).toEqual([
      { id: 1, text: "erster", version: "1.0.0" },
    ]);
    const migriert = Bun.spawnSync(["bun", SERVER, "migrieren"], {
      env: env({ BEISPIEL_VERSION: "2.0.0" }),
    });
    expect(migriert.exitCode).toBe(0);
  });

  it("refuses to start with the title of the tests that must fail (Z-404)", () => {
    const lauf = Bun.spawnSync(["bun", SERVER], {
      env: env({ BEISPIEL_HTTP_PORT: "28485", BEISPIEL_TITEL: "beim-start-scheitern" }),
    });
    expect(lauf.exitCode).toBe(1);
  });

  it("shows the title it was given", async () => {
    await starten(28486, 28487, { BEISPIEL_TITEL: "Neu" });
    expect(await (await fetch("http://127.0.0.1:28486/")).json()).toMatchObject({ titel: "Neu" });
  });

  it("writes the values BEISPIEL_AUSGEBEN names to its log at its start, and only those (Z-405)", async () => {
    const lauf = Bun.spawn(["bun", SERVER], {
      env: env({
        BEISPIEL_HTTP_PORT: "28488",
        BEISPIEL_TCP_PORT: "28489",
        BEISPIEL_AUSGEBEN: "BEISPIEL_SCHLUESSEL,BEISPIEL_PASSWORT",
        BEISPIEL_SCHLUESSEL: "auto+Wert/1==",
        BEISPIEL_PASSWORT: "pw-4711",
        BEISPIEL_TITEL: "nicht-genannt",
      }),
      stdout: "pipe",
    });
    prozesse.push(lauf);
    const leser = lauf.stdout.getReader();
    let aus = "";
    while (!aus.includes("beispiel listening")) {
      const { done, value } = await leser.read();
      if (done) break;
      aus += new TextDecoder().decode(value);
    }
    leser.releaseLock();
    expect(aus).toContain("beispiel test: BEISPIEL_SCHLUESSEL=auto+Wert/1==\n");
    expect(aus).toContain("beispiel test: BEISPIEL_PASSWORT=pw-4711\n");
    expect(aus).not.toContain("nicht-genannt");
  });

  it("answers health red in its broken build", async () => {
    expect((await starten(28483, 28484, { BEISPIEL_KAPUTT: "1" })).status).toBe(500);
  });

  // The agent runs `migrieren` by podman exec while the app writes (BAULISTE.md Z-402): without a
  // busy timeout SQLite answers "database is locked" at once and the setup fails now and then
  it("migrates while another connection holds the write lock for a moment", async () => {
    const ordner = join(daten, "gesperrt");
    mkdirSync(ordner, { recursive: true });
    const halter = new Database(join(ordner, "beispiel.db"), { create: true });
    halter.run("PRAGMA journal_mode = WAL");
    halter.run("BEGIN IMMEDIATE");
    halter.run("CREATE TABLE IF NOT EXISTS sperre (x INTEGER)");
    const migration = Bun.spawn(["bun", SERVER, "migrieren"], {
      env: env({ BEISPIEL_DATEN: ordner }),
      stdout: "ignore",
      stderr: "pipe",
    });
    await Bun.sleep(1000);
    halter.run("COMMIT");
    halter.close();
    const code = await migration.exited;
    expect(code, await new Response(migration.stderr).text()).toBe(0);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
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

  it("answers health red in its broken build", async () => {
    expect((await starten(28483, 28484, { BEISPIEL_KAPUTT: "1" })).status).toBe(500);
  });
});

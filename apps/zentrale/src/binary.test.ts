import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oeffneDatenbank } from "./db/oeffnen.ts";
import { schreiben } from "./modules/audit/index.ts";
import { schluesselAus } from "./modules/geheim/verschluesseln.ts";
import { serverAnlegen } from "./modules/server/index.ts";
import { testAnfrage } from "./testhilfen/agent.ts";

// The compiled binary carries its migrations: started in an empty data directory it creates the
// database (Z-102), and it refuses to start on a database whose applied migration was changed
const ordner = mkdtempSync(join(tmpdir(), "sz-test-binary-"));
const binary = join(ordner, "steuerzentrale");
const KEY = Buffer.alloc(32, 7).toString("base64");
// The interface's address (here never reached): Better Auth's origin and the passkeys' domain
const URL_ = "http://localhost:28300";
const AGENT_ = "http://localhost:28300";
const target = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
const REPO = join(import.meta.dirname, "../../..");
const MANIFESTE = join(import.meta.dirname, "testhilfen/manifeste");

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
        STEUERZENTRALE_AGENT_URL: AGENT_,
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
        STEUERZENTRALE_AGENT_URL: AGENT_,
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
        STEUERZENTRALE_AGENT_URL: AGENT_,
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
      env: {
        STEUERZENTRALE_PORT: "28393",
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: AGENT_,
      },
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
        STEUERZENTRALE_AGENT_URL: AGENT_,
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
        STEUERZENTRALE_AGENT_URL: AGENT_,
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
        STEUERZENTRALE_AGENT_URL: AGENT_,
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
        STEUERZENTRALE_AGENT_URL: AGENT_,
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
        STEUERZENTRALE_AGENT_URL: AGENT_,
      },
    });
    expect(await alt.exited).toBe(1);
  }, 30_000);

  // Z-501: `steuerzentrale manifest importieren <pfad>` with `<pfad>.minisig` beside it
  it("imports a signed manifest on command, and refuses another text for its version", async () => {
    const daten = join(ordner, "manifest");
    mkdirSync(daten, { recursive: true });
    const schluessel = schluesselAus(KEY);
    if (!schluessel.ok) throw new Error("test key");
    const offen = oeffneDatenbank(join(daten, "zentrale.db"), 1, {
      aktuell: schluessel.schluessel,
      alt: [],
    });
    const kontext = { betreiberId: "b1", akteur: "test", jetzt: 1, grund: "Test" };
    schreiben(offen.schreibDb, kontext, "test", (w) =>
      w.einfuegen("betreiber", { betreiberId: "b1", name: "Teufel IT", angelegtAm: 1 }),
    );
    offen.schliessen();
    const dateien = join(ordner, "agent-dateien");
    mkdirSync(dateien, { recursive: true });
    copyFileSync(join(REPO, "test/schluessel/test.pub"), join(dateien, "minisign.pub"));
    const importieren = (name: string) => {
      const pfad = join(ordner, `${name}.yml`);
      copyFileSync(join(MANIFESTE, `${name}.yml`), pfad);
      copyFileSync(join(MANIFESTE, `${name}.yml.minisig`), `${pfad}.minisig`);
      return Bun.spawn([binary, "manifest", "importieren", pfad], {
        env: {
          STEUERZENTRALE_DATA: daten,
          STEUERZENTRALE_SECRET_KEY: KEY,
          STEUERZENTRALE_URL: URL_,
          STEUERZENTRALE_AGENT_URL: AGENT_,
          STEUERZENTRALE_AGENT_DATEIEN: dateien,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    };
    const erster = importieren("probe");
    expect(await erster.exited).toBe(0);
    expect(await new Response(erster.stdout).text()).toContain('"manifest imported"');
    const anders = importieren("probe-anders");
    expect(await anders.exited).toBe(1);
    expect(await new Response(anders.stderr).text()).toContain("version_vergeben");
    const sqlite = new Database(join(daten, "zentrale.db"), { readonly: true });
    const zeilen = sqlite
      .query<{ app: string; version: string; importiert_von: string }, []>(
        "SELECT app, version, importiert_von FROM manifeste",
      )
      .all();
    sqlite.close();
    expect(zeilen).toEqual([{ app: "probe", version: "1.0.0", importiert_von: "befehl" }]);
  }, 30_000);

  // Z-1002: backed up while it runs, restored into the empty data directory of a "new server"
  it("backs up while it runs and starts from the backup restored elsewhere", async () => {
    const alt = join(ordner, "sicherung-alt");
    const neu = join(ordner, "sicherung-neu");
    const datei = join(ordner, "zentrale.sicherung.db");
    const env = (daten: string, port: string, key = KEY) => ({
      STEUERZENTRALE_PORT: port,
      STEUERZENTRALE_DATA: daten,
      STEUERZENTRALE_SECRET_KEY: key,
      STEUERZENTRALE_URL: URL_,
      STEUERZENTRALE_AGENT_URL: AGENT_,
    });
    const laufend = Bun.spawn([binary], { env: env(alt, "28386"), stdout: "ignore" });
    try {
      await warteAuf("http://127.0.0.1:28386/health");
      const sichern = Bun.spawn([binary, "sichern", datei], { env: env(alt, "1"), stdout: "pipe" });
      expect(await sichern.exited).toBe(0);
      expect(await new Response(sichern.stdout).text()).toContain('"backed up"');
    } finally {
      laufend.kill();
      await laufend.exited;
    }
    const falsch = Buffer.alloc(32, 9).toString("base64");
    const abgelehnt = Bun.spawn([binary, "wiederherstellen", datei], {
      env: env(neu, "1", falsch),
      stderr: "pipe",
    });
    expect(await abgelehnt.exited).toBe(1);
    const meldung = await new Response(abgelehnt.stderr).text();
    expect(meldung).toContain("does not open this database");
    expect(meldung).not.toContain(falsch);
    const zurueck = Bun.spawn([binary, "wiederherstellen", datei], { env: env(neu, "1") });
    expect(await zurueck.exited).toBe(0);
    const gestartet = Bun.spawn([binary], { env: env(neu, "28387"), stdout: "ignore" });
    try {
      expect((await warteAuf("http://127.0.0.1:28387/health")).status).toBe(200);
    } finally {
      gestartet.kill();
      await gestartet.exited;
    }
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
      STEUERZENTRALE_AGENT_URL: AGENT_,
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

describe("the compiled Zentrale and its agents (BAULISTE.md Z-302)", () => {
  // In one binary the passkeys' @peculiar/x509 and this one share tsyringe's container: with two
  // major lines the later one's algorithms broke issuing (allowed-dependencies.json)
  it("exchanges a join token for a client certificate", async () => {
    const daten = join(ordner, "beitritt");
    const port = 28388;
    const env = {
      STEUERZENTRALE_PORT: String(port),
      STEUERZENTRALE_DATA: daten,
      STEUERZENTRALE_SECRET_KEY: KEY,
      STEUERZENTRALE_URL: URL_,
      STEUERZENTRALE_AGENT_URL: AGENT_,
    };
    const prozess = Bun.spawn([binary], { env, stdout: "ignore" });
    try {
      await warteAuf(`http://127.0.0.1:${port}/health`);
      const schluessel = schluesselAus(KEY);
      if (!schluessel.ok) throw new Error("test key");
      const offen = oeffneDatenbank(join(daten, "zentrale.db"), Date.now(), {
        aktuell: schluessel.schluessel,
        alt: [],
      });
      const kontext = { betreiberId: "b", akteur: "test", jetzt: Date.now(), grund: "Test" };
      const { token } = serverAnlegen(offen.schreibDb, kontext, {
        name: "s",
        art: "gemeinsam",
        wartungsfenster: { tage: [1], von: "03:30", bis: "04:30" },
      });
      offen.schliessen();
      const antwort = await fetch(`http://127.0.0.1:${port}/api/v1/agent/beitreten`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await testAnfrage(token)),
      });
      expect(antwort.status).toBe(201);
      expect(((await antwort.json()) as { zertifikat: string }).zertifikat).toContain(
        "BEGIN CERTIFICATE",
      );
    } finally {
      prozess.kill();
      await prozess.exited;
    }
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

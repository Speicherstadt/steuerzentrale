import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { PATH } from "../einrichtung/nutzer.ts";
import { ausfuehren, EINGABE_PRAEFIX, echtSpawn, imContainer, MARKE } from "./ausfuehren.ts";
import type { Plan } from "./pruefen.ts";

/*
 * BAULISTE.md Z-305: the real spawn starts a fixed argv without a shell and kills it when the time
 * limit runs out; tried with real processes, not through podman.
 */
const echtPlanen = (lauf: () => void, ms: number) => {
  const t = setTimeout(lauf, ms);
  return () => clearTimeout(t);
};

/** A duration no other process has in its argv, so pgrep finds only the test's own sleep */
const einmalig = () => `299.${crypto.getRandomValues(new Uint32Array(1))[0]}`;

/** Whether a process with exactly this argv runs; a zombie has none and does not count */
const lebt = (argv: string) => Bun.spawnSync(["pgrep", "-f", "-x", argv]).exitCode === 0;

const toeten = (argv: string) => Bun.spawnSync(["pkill", "-KILL", "-f", "-x", argv]);

/** Asks for up to 5 s whether it holds */
const bis = async (gilt: () => boolean): Promise<boolean> => {
  for (let i = 0; i < 100; i++) {
    if (gilt()) return true;
    await Bun.sleep(50);
  }
  return gilt();
};

const PLAN: Plan = {
  art: "befehl",
  aktion: "langsam",
  installationId: "i",
  container: "app",
  argv: ["sleep", "30"],
  zeitlimitMs: 100,
  idempotent: false,
};

const NUTZER = { name: "sz-i", uid: 1001, gid: 1001, home: "/home/sz-i" };

describe("echtSpawn", () => {
  it("kills a process that runs past the abort", async () => {
    const abbruch = new AbortController();
    const beginn = Date.now();
    const lauf = echtSpawn(["sleep", "30"], abbruch.signal);
    setTimeout(() => abbruch.abort(), 50);
    const { code } = await lauf;
    expect(code).not.toBe(0);
    expect(Date.now() - beginn).toBeLessThan(5000);
  });

  // Podman 4.9 reads `secret create … -` only from a named pipe (cmd/podman/secrets/create.go);
  // Bun hands a buffer or "pipe" over as a socket, which it refuses
  it("hands its input over on a named pipe, all of it, and leaves no file behind", async () => {
    const signal = new AbortController().signal;
    expect(
      (await echtSpawn(["test", "-p", "/dev/stdin"], signal, { eingabe: "geheim" })).code,
    ).toBe(0);
    expect((await echtSpawn(["grep", "-qx", "geheim"], signal, { eingabe: "geheim" })).code).toBe(
      0,
    );
    expect((await echtSpawn(["grep", "-qx", "anders"], signal, { eingabe: "geheim" })).code).toBe(
      1,
    );
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith(EINGABE_PRAEFIX))).toEqual([]);
  });

  // Review Z-402: the pipe's buffer holds 64 KiB; a longer input written before the process reads
  // blocked writeSync, and with it the agent's whole event loop, for ever. In a child process, so
  // that a hang fails this test instead of the test run
  it("does not hang the agent on an input longer than a pipe's buffer", async () => {
    const skript = [
      `import { echtSpawn } from ${JSON.stringify(new URL("./ausfuehren.ts", import.meta.url).pathname)};`,
      `try { await echtSpawn(["cat"], new AbortController().signal, { eingabe: "x".repeat(100_000) }); } catch {}`,
      "process.exit(0);",
    ].join("\n");
    const kind = Bun.spawn(["bun", "-e", skript], { stdout: "ignore", stderr: "ignore" });
    const zeit = setTimeout(() => kind.kill("SIGKILL"), 10_000);
    const code = await kind.exited;
    clearTimeout(zeit);
    expect(code).toBe(0);
  }, 15_000);

  it("hands each word over as it is, with no shell to read it", async () => {
    const { code } = await echtSpawn(
      ["test", "$(false)", "=", "$(false)"],
      new AbortController().signal,
    );
    expect(code).toBe(0);
  });

  it("hands the input to the process on its standard input", async () => {
    const abbruch = new AbortController().signal;
    expect(
      (await echtSpawn(["grep", "-qx", "geheim"], abbruch, { eingabe: "geheim\n" })).code,
    ).toBe(0);
    expect(
      (await echtSpawn(["grep", "-qx", "geheim"], abbruch, { eingabe: "anders\n" })).code,
    ).toBe(1);
  });

  it("throws for a program that is not there", async () => {
    await expect(
      echtSpawn(["/nicht/da/steuerzentrale"], new AbortController().signal),
    ).rejects.toThrow();
  });

  // Review of PR #24: runuser forks and waits for its child (env, then podman exec); SIGKILL to
  // runuser alone left the child running. timeout --foreground forks the same way, in the same
  // process group, without needing root as runuser does
  it("kills the children of a process that runs past the abort, not only the process", async () => {
    const dauer = einmalig();
    const abbruch = new AbortController();
    try {
      const lauf = echtSpawn(["timeout", "--foreground", "300", "sleep", dauer], abbruch.signal);
      expect(await bis(() => lebt(`sleep ${dauer}`))).toBe(true);
      abbruch.abort();
      await lauf;
      expect(await bis(() => !lebt(`sleep ${dauer}`))).toBe(true);
    } finally {
      toeten(`sleep ${dauer}`);
    }
  }, 15_000);

  // podman exec's command runs under conmon, outside the process group (conmon starts with
  // Setpgid, libpod/oci_conmon_exec_common.go in Podman 4.9): only its mark finds it
  it("kills, after the abort, every process that carries its mark, and no other", async () => {
    const marke = crypto.randomUUID();
    const [drin, anders, eigen] = [einmalig(), einmalig(), einmalig()];
    const mitMarke = (dauer: string, wert: string) =>
      Bun.spawn(["sleep", dauer], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: { PATH, [MARKE]: wert },
      });
    mitMarke(drin, marke);
    mitMarke(anders, crypto.randomUUID());
    const abbruch = new AbortController();
    try {
      expect(await bis(() => lebt(`sleep ${drin}`) && lebt(`sleep ${anders}`))).toBe(true);
      const lauf = echtSpawn(["sleep", eigen], abbruch.signal, { marke });
      abbruch.abort();
      await lauf;
      expect(await bis(() => !lebt(`sleep ${drin}`))).toBe(true);
      expect(lebt(`sleep ${anders}`)).toBe(true);
    } finally {
      for (const d of [drin, anders, eigen]) toeten(`sleep ${d}`);
    }
  }, 15_000);

  it("leaves what carries its mark alone when the process ended by itself", async () => {
    const marke = crypto.randomUUID();
    const drin = einmalig();
    Bun.spawn(["sleep", drin], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { PATH, [MARKE]: marke },
    });
    try {
      expect(await bis(() => lebt(`sleep ${drin}`))).toBe(true);
      expect((await echtSpawn(["true"], new AbortController().signal, { marke })).code).toBe(0);
      expect(lebt(`sleep ${drin}`)).toBe(true);
    } finally {
      toeten(`sleep ${drin}`);
    }
  }, 15_000);
});

describe("imContainer", () => {
  it("marks the command in the container with a value of its own for each run", () => {
    const n = { name: "sz-i", uid: 1001, gid: 1001, home: "/home/sz-i" };
    const a = imContainer(n, "i-app", ["sleep", "30"]);
    const b = imContainer(n, "i-app", ["sleep", "30"]);
    expect(a.marke).not.toBe(b.marke);
    expect(a.marke).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.argv.slice(a.argv.indexOf("podman"))).toEqual([
      "podman",
      "exec",
      "--env",
      `${MARKE}=${a.marke}`,
      "i-app",
      "sleep",
      "30",
    ]);
    expect(a.argv.slice(0, 3)).toEqual(["runuser", "-u", "sz-i"]);
  });
});

describe("ausfuehren", () => {
  it("hands the spawn the mark that its argv gives the container", async () => {
    const gesehen: { argv: readonly string[]; marke?: string }[] = [];
    await ausfuehren(
      {
        spawn: async (argv, _signal, o) => {
          gesehen.push({ argv, ...(o?.marke === undefined ? {} : { marke: o.marke }) });
          return { code: 0 };
        },
        planen: echtPlanen,
      },
      PLAN,
      NUTZER,
    );
    const [lauf] = gesehen;
    expect(lauf?.marke).toBeDefined();
    expect(lauf?.argv).toContain(`${MARKE}=${lauf?.marke}`);
  });
});

describe("ausfuehren with the real spawn", () => {
  it("reports the time limit when it had to kill", async () => {
    // podman and the installation's user are not here: a stand-in that runs the plan's argv
    // without runuser's and podman's prefix
    const ergebnis = await ausfuehren(
      {
        spawn: (argv, signal) => echtSpawn(argv.slice(argv.indexOf("i-app") + 1), signal),
        planen: echtPlanen,
      },
      {
        art: "befehl",
        aktion: "langsam",
        installationId: "i",
        container: "app",
        argv: ["sleep", "30"],
        zeitlimitMs: 100,
        idempotent: false,
      },
      { name: "sz-i", uid: 1001, gid: 1001, home: "/home/sz-i" },
    );
    expect(ergebnis).toEqual({
      ok: false,
      fehler: "Zeitlimit von 0.1 s überschritten, Befehl beendet",
    });
  });
});

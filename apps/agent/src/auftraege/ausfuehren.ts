import { closeSync, constants, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alsNutzer, type Nutzer, PATH } from "../einrichtung/nutzer.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import { markierteBeenden } from "./beenden.ts";
import type { Plan } from "./pruefen.ts";

/*
 * Running a checked job (BAULISTE.md Z-305): the command's argv from the signed manifest as a fixed
 * argv in its installation's container, never through a shell, killed when its time limit runs
 * out. Since Z-402 it runs as the installation's Linux user (docs/plan.md, "Was ein Auftrag
 * ausführt"), whose rootless Podman runs the container. At the time limit nothing it started runs
 * on: not runuser's children, not the command under conmon (echtSpawn, beenden.ts). The process
 * is started by a spawn passed in, so the logic is tested without one.
 */

export type SpawnOptionen = {
  /** Its standard input */
  eingabe?: string;
  /** The mark of a command in a container (imContainer): what carries it is killed with it */
  marke?: string;
};

/**
 * Runs a fixed argv; the signal kills it with all it started (its process group, and what carries
 * its mark). Throws when it cannot start
 */
export type Spawn = (
  argv: readonly string[],
  signal: AbortSignal,
  o?: SpawnOptionen,
) => Promise<{ code: number | null }>;

export type Ergebnis = { ok: true; daten: Record<string, unknown> } | { ok: false; fehler: string };

/** The environment entry that marks a command in a container (beenden.ts) */
export const MARKE = "STEUERZENTRALE_LAUF";

/**
 * `podman exec` of a fixed argv as the installation's user, marked with a value of its own for
 * this run, so that after a time limit the command is found under conmon (beenden.ts)
 */
export const imContainer = (
  nutzer: Nutzer,
  container: string,
  argv: readonly string[],
): { argv: string[]; marke: string } => {
  const marke = crypto.randomUUID();
  return {
    argv: alsNutzer(nutzer, ["podman", "exec", "--env", `${MARKE}=${marke}`, container, ...argv]),
    marke,
  };
};

/** The container of an installation is named `<installation>-<container>` (its Quadlet unit) */
export const befehl = (plan: Plan, nutzer: Nutzer) =>
  imContainer(nutzer, `${plan.installationId}-${plan.container}`, plan.argv);

/** The folder of a named pipe for a process's input, under the agent's temporary folder */
export const EINGABE_PRAEFIX = "sz-eingabe-";

/**
 * A process's input on a named pipe, the read end of it: Podman 4.9 takes `secret create … -` only
 * from one (cmd/podman/secrets/create.go), and Bun hands a buffer or "pipe" over as a socket. The
 * value is written into the pipe's buffer (a secret is far below its 64 KiB; a longer input is
 * refused, never waited for) and the write end
 * closed, so the process reads it and then the end; the pipe's node is gone before the process
 * starts, in a folder only its owner (root) can enter: the value is never on disk, in an argv or in
 * the environment. The caller closes the descriptor once the process has it
 */
/**
 * Writes the input into the pipe without ever blocking: nobody reads it before the process starts,
 * so a blocking write longer than the buffer would stop the agent's event loop for good. An input
 * the buffer cannot hold is refused instead (the error names no part of it)
 */
const rohrFuellen = (rohr: string, eingabe: string): void => {
  const bytes = Buffer.from(eingabe, "utf8");
  const schreiben = openSync(rohr, constants.O_WRONLY | constants.O_NONBLOCK);
  try {
    let geschrieben = 0;
    while (geschrieben < bytes.length)
      geschrieben += writeSync(schreiben, bytes, geschrieben, bytes.length - geschrieben);
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === "EAGAIN")
      throw new Error(`the input of ${bytes.length} bytes is longer than a pipe's buffer`);
    throw fehler;
  } finally {
    closeSync(schreiben);
  }
};

export const eingabeRohr = (eingabe: string): number => {
  const ordner = mkdtempSync(join(tmpdir(), EINGABE_PRAEFIX));
  try {
    const rohr = join(ordner, "eingabe");
    const mk = Bun.spawnSync(["mkfifo", "-m", "0600", rohr], { cwd: "/", env: { PATH } });
    if (mk.exitCode !== 0) throw new Error("mkfifo failed");
    const lesen = openSync(rohr, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      rohrFuellen(rohr, eingabe);
    } catch (fehler) {
      closeSync(lesen);
      throw fehler;
    }
    return lesen;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
};

/**
 * SIGKILL to the process group the process leads, while the process is not known to have ended
 * (so a reaped pid is never signalled). runuser forks without a group or session of its own and
 * waits for its child (checked with util-linux 2.39), so its child `env`, then `podman exec`, is in
 * the group
 */
const gruppeToeten = (lauf: ReturnType<typeof Bun.spawn>): void => {
  if (lauf.exitCode !== null || lauf.signalCode !== null) return;
  try {
    process.kill(-lauf.pid, "SIGKILL");
  } catch {
    // ended meanwhile
  }
};

/**
 * Kills the process group of a process started with Bun's `detached` (its own session) when the
 * signal aborts; returns what takes the listener off again, once the process has ended
 */
export const gruppeBeiAbbruch = (
  lauf: ReturnType<typeof Bun.spawn>,
  signal: AbortSignal,
): (() => void) => {
  const abbrechen = () => gruppeToeten(lauf);
  signal.addEventListener("abort", abbrechen, { once: true });
  if (signal.aborted) abbrechen();
  return () => signal.removeEventListener("abort", abbrechen);
};

/**
 * Bun's spawn: no shell, input only when given (a Podman secret, on a named pipe), output dropped
 * (log excerpts come with Z-405), in / and with no environment of the agent's but PATH: what a
 * process as another user needs, runuser and `env -i` set (einrichtung/nutzer.ts). It starts in a
 * session of its own (setsid, Bun's `detached`), so that on abort SIGKILL reaches its whole
 * process group, runuser and all it forked, not runuser alone; then whatever carries its mark,
 * the command `podman exec` left under conmon (beenden.ts)
 */
export const echtSpawn: Spawn = async (argv, signal, o = {}) => {
  const rohr = o.eingabe === undefined ? undefined : eingabeRohr(o.eingabe);
  let lauf: ReturnType<typeof Bun.spawn>;
  try {
    lauf = Bun.spawn([...argv], {
      stdin: rohr ?? "ignore",
      stdout: "ignore",
      stderr: "ignore",
      cwd: "/",
      detached: true,
      env: { PATH, LC_ALL: "C" },
    });
  } finally {
    if (rohr !== undefined) closeSync(rohr);
  }
  const aufheben = gruppeBeiAbbruch(lauf, signal);
  let code: number | null;
  try {
    code = (await lauf.exited) ?? null;
  } finally {
    aufheben();
  }
  if (signal.aborted && o.marke !== undefined) await markierteBeenden(`${MARKE}=${o.marke}`);
  return { code };
};

const kurz = (text: string) => text.slice(0, 500);

/**
 * Runs the plan as the installation's user within its time limit; an argv still running then is
 * killed and the job failed. A non-zero exit fails it too; the exit code is the result's data.
 */
export const ausfuehren = async (
  deps: { spawn: Spawn; planen: Planer },
  plan: Plan,
  nutzer: Nutzer,
): Promise<Ergebnis> => {
  const abbruch = new AbortController();
  let abgelaufen = false;
  const aufheben = deps.planen(() => {
    abgelaufen = true;
    abbruch.abort();
  }, plan.zeitlimitMs);
  try {
    const { argv, marke } = befehl(plan, nutzer);
    const { code } = await deps.spawn(argv, abbruch.signal, { marke });
    if (abgelaufen)
      return {
        ok: false,
        fehler: `Zeitlimit von ${plan.zeitlimitMs / 1000} s überschritten, Befehl beendet`,
      };
    return code === 0
      ? { ok: true, daten: { code } }
      : { ok: false, fehler: `Befehl endete mit Code ${code ?? "–"}` };
  } catch (fehler) {
    return { ok: false, fehler: kurz(`Befehl startete nicht: ${String(fehler)}`) };
  } finally {
    aufheben();
  }
};

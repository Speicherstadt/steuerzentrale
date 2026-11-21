import type { Planer } from "../verbindung/verbinden.ts";
import type { Plan } from "./pruefen.ts";

/*
 * Running a checked job (BAULISTE.md Z-305): the command's argv from the signed manifest as a fixed
 * argv in its installation's container, never through a shell, killed when its time limit runs
 * out. The process is started by a spawn passed in, so the logic is tested without one; Z-402
 * brings the installation's Linux user and its units, which the real spawn then runs as.
 */

/** Runs a fixed argv; the signal kills it. Throws when it cannot start */
export type Spawn = (
  argv: readonly string[],
  signal: AbortSignal,
) => Promise<{ code: number | null }>;

export type Ergebnis = { ok: true; daten: Record<string, unknown> } | { ok: false; fehler: string };

/** The container of an installation is named `<installation>-<container>` (its Quadlet unit) */
export const befehlArgv = (plan: Plan): string[] => [
  "podman",
  "exec",
  `${plan.installationId}-${plan.container}`,
  ...plan.argv,
];

const PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** The agent's own HOME and XDG_RUNTIME_DIR, where podman finds its storage and its socket */
const umgebung = (): Record<string, string> =>
  Object.fromEntries(
    ["HOME", "XDG_RUNTIME_DIR"].flatMap((name) => {
      const wert = process.env[name];
      return wert === undefined ? [] : [[name, wert]];
    }),
  );

/**
 * Bun's spawn: no shell, no input, output dropped (log excerpts come with Z-405), SIGKILL on abort,
 * and of the agent's environment only what podman needs
 */
export const echtSpawn: Spawn = async (argv, signal) => {
  const lauf = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    signal,
    killSignal: "SIGKILL",
    env: { PATH, LC_ALL: "C", ...umgebung() },
  });
  return { code: (await lauf.exited) ?? null };
};

const kurz = (text: string) => text.slice(0, 500);

/**
 * Runs the plan within its time limit; an argv still running then is killed and the job failed.
 * A non-zero exit fails it too; the exit code is the result's data.
 */
export const ausfuehren = async (
  deps: { spawn: Spawn; planen: Planer },
  plan: Plan,
): Promise<Ergebnis> => {
  const abbruch = new AbortController();
  let abgelaufen = false;
  const aufheben = deps.planen(() => {
    abgelaufen = true;
    abbruch.abort();
  }, plan.zeitlimitMs);
  try {
    const { code } = await deps.spawn(befehlArgv(plan), abbruch.signal);
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

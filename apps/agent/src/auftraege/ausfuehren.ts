import { alsNutzer, type Nutzer, PATH } from "../einrichtung/nutzer.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import type { Plan } from "./pruefen.ts";

/*
 * Running a checked job (BAULISTE.md Z-305): the command's argv from the signed manifest as a fixed
 * argv in its installation's container, never through a shell, killed when its time limit runs
 * out. Since Z-402 it runs as the installation's Linux user (docs/plan.md, "Was ein Auftrag
 * ausführt"), whose rootless Podman runs the container. The process is started by a spawn passed
 * in, so the logic is tested without one.
 */

/** Runs a fixed argv; the signal kills it; `eingabe` is its standard input. Throws when it cannot start */
export type Spawn = (
  argv: readonly string[],
  signal: AbortSignal,
  eingabe?: string,
) => Promise<{ code: number | null }>;

export type Ergebnis = { ok: true; daten: Record<string, unknown> } | { ok: false; fehler: string };

/** The container of an installation is named `<installation>-<container>` (its Quadlet unit) */
export const befehlArgv = (plan: Plan, nutzer: Nutzer): string[] =>
  alsNutzer(nutzer, ["podman", "exec", `${plan.installationId}-${plan.container}`, ...plan.argv]);

/**
 * Bun's spawn: no shell, input only when given (a Podman secret), output dropped (log excerpts come
 * with Z-405), SIGKILL on abort, in / and with no environment of the agent's but PATH: what a
 * process as another user needs, runuser and `env -i` set (einrichtung/nutzer.ts)
 */
export const echtSpawn: Spawn = async (argv, signal, eingabe) => {
  const lauf = Bun.spawn([...argv], {
    stdin: eingabe === undefined ? "ignore" : new TextEncoder().encode(eingabe),
    stdout: "ignore",
    stderr: "ignore",
    cwd: "/",
    signal,
    killSignal: "SIGKILL",
    env: { PATH, LC_ALL: "C" },
  });
  return { code: (await lauf.exited) ?? null };
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
    const { code } = await deps.spawn(befehlArgv(plan, nutzer), abbruch.signal);
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

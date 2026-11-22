import { readdirSync, readFileSync } from "node:fs";

/*
 * Ending what a command in a container left running at its time limit (docs/auftraege.md,
 * "Zeitlimit"). `podman exec` hands the command to conmon, which Podman 4.9 starts in a process
 * group of its own (`Setpgid: true`, libpod/oci_conmon_exec_common.go) and which does not end the
 * command when `podman exec` is killed; Podman 4.9's `podman exec` has no option for that either
 * (podman-exec(1)). So each run marks its command with an environment entry of its own
 * (`--env STEUERZENTRALE_LAUF=<uuid>`), and after the time limit the agent (root) kills every
 * process whose environment holds exactly that entry: the command and the children that inherited
 * it, in whatever process group or PID namespace they are. An environment is only compared here,
 * never kept or written anywhere.
 */

/** Whether an environment as /proc/<pid>/environ holds it (NUL-separated) has the entry */
export const traegt = (environ: string, eintrag: string): boolean =>
  environ.split("\0").includes(eintrag);

const lesen = (pfad: string): string | undefined => {
  try {
    return readFileSync(pfad, "latin1");
  } catch {
    // gone meanwhile, or a kernel thread
    return undefined;
  }
};

/** The processes under `proc` whose environment holds the entry */
export const mitEintrag = (eintrag: string, proc = "/proc"): number[] =>
  readdirSync(proc)
    .filter((name) => /^[1-9][0-9]*$/.test(name))
    .filter((name) => traegt(lesen(`${proc}/${name}/environ`) ?? "", eintrag))
    .map(Number);

const toeten = (pid: number): void => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ended meanwhile
  }
};

/** Rounds of looking: a process may fork while the one before is killed */
const RUNDEN = 5;

/**
 * Kills every process that carries the entry, until a look finds none. A killed process is a
 * zombie until it is reaped, with an empty environment, so it is not found again
 */
export const markierteBeenden = async (eintrag: string, proc = "/proc"): Promise<void> => {
  for (let i = 0; i < RUNDEN; i++) {
    const gefunden = mitEintrag(eintrag, proc);
    if (gefunden.length === 0) return;
    for (const pid of gefunden) toeten(pid);
    await Bun.sleep(50);
  }
};

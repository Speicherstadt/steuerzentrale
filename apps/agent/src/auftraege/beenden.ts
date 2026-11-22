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

/**
 * How long the agent keeps looking after the abort: conmon still starts the command when
 * `podman exec` died before handing it over (it reads EOF on its start pipe and goes on,
 * containers/conmon src/conmon.c), so the command can appear after a first empty look
 * (review of PR #25). conmon goes on at once, so a few seconds hold it
 */
export const NACHLAUF_MS = 3000;
const ABSTAND_MS = 100;

/**
 * Kills every process that carries the entry, looking again every 100 ms until the end of the
 * after-run. A killed process is a zombie until it is reaped, with an empty environment, so it is
 * not found again
 */
export const markierteBeenden = async (eintrag: string, proc = "/proc"): Promise<void> => {
  const ende = Date.now() + NACHLAUF_MS;
  for (;;) {
    for (const pid of mitEintrag(eintrag, proc)) toeten(pid);
    if (Date.now() >= ende) return;
    await Bun.sleep(ABSTAND_MS);
  }
};

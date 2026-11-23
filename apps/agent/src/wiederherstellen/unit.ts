/*
 * The transient unit a restore plays each part back in (BAULISTE.md Z-603; docs/plan.md,
 * "Wiederherstellen auf dem Server (Z-603)"), as the installation's user: `systemd-run --user
 * --wait --collect --pipe` (systemd-run(1), systemd v255): the binary's standard input and output
 * are those of systemd-run, which waits for the end and exits with the service's code, and the unit
 * is unloaded afterwards even when it failed. `RuntimeMaxSec` ends it, with every process in its
 * cgroup, by the job's deadline even when the agent is gone: killing systemd-run alone leaves the
 * service running (src/run/run.c waits for no signal with --pipe), which is why the agent also
 * stops the unit by its fixed name after a failure. `Delegate=yes` lets Podman split the unit's
 * cgroup for restic's container (`--cgroups split`, as Quadlet does: podman v4.9.3,
 * pkg/systemd/quadlet/quadlet.go), so conmon and restic die with it. Pure.
 */

/** Its name has an underscore like the backup's units: no container's unit has one */
export const WIEDERHERSTELLEN_UNIT = "sz_wiederherstellen.service";

/** After SIGTERM the unit's processes get this long, then SIGKILL (systemd's default is 90 s) */
const STOPP_S = 15;

/** The binary's argv as the content of the transient unit, ended after `sekunden` at most */
export const inEigenerUnit = (sekunden: number, argv: readonly string[]): string[] => [
  "systemd-run",
  "--user",
  "--unit",
  WIEDERHERSTELLEN_UNIT,
  "--quiet",
  "--wait",
  "--collect",
  "--pipe",
  "--property",
  `RuntimeMaxSec=${sekunden}`,
  "--property",
  `TimeoutStopSec=${STOPP_S}`,
  "--property",
  "Delegate=yes",
  "--",
  ...argv,
];

/** The whole seconds left until the deadline, one at least */
export const restSekunden = (ende: number, jetzt: number): number =>
  Math.max(1, Math.ceil((ende - jetzt) / 1000));

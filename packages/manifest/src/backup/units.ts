import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import { unitText } from "../quadlet/systemd.ts";
import { BACKUP_ZEITLIMIT_S } from "./auftraege.ts";

/*
 * The backup's timer and service under the installation's user (BAULISTE.md Z-601; docs/plan.md,
 * "Backup auf dem Server"; systemd.timer(5), systemd.service(5)): daily with a random delay of up
 * to an hour, so the servers do not all write to S3 at midnight, and `Persistent=true`, so a run
 * missed while the server was off comes after its start. The service runs the agent's binary as
 * the user with `sichern <installation>`; it needs no Zentrale. Pure.
 */

/** Where install.sh puts the agent (install/install.sh, BINARY) */
export const AGENT_BINARY = "/usr/local/bin/steuerzentrale-agent";

/**
 * A container's unit is `<installation>-<container>` of lowercase letters, digits and dashes
 * (container.ts); with an underscore no container of the installation can take these names
 */
export const BACKUP_SERVICE = "sz_backup.service";
export const BACKUP_TIMER = "sz_backup.timer";

const kopf = (installation: string) =>
  `Backup of the installation ${installation}, rendered by the Steuerzentrale; do not edit`;

/** The two units, by file name under ~/.config/systemd/user/ */
export const backupUnits = (
  installation: string,
  agent: string = AGENT_BINARY,
): Record<string, string> => {
  // ExecStart= splits at spaces: the name and the path are plain words
  if (!INSTALLATIONS_NAME.test(installation)) throw new Error("not an installation's name");
  if (!/^(\/[A-Za-z0-9._-]+)+$/.test(agent)) throw new Error("not a plain absolute path");
  return {
    [BACKUP_SERVICE]: unitText(kopf(installation), [
      { name: "Unit", zeilen: [["Description", `Backup ${installation} (Steuerzentrale)`]] },
      {
        name: "Service",
        zeilen: [
          ["Type", "oneshot"],
          ["ExecStart", `${agent} sichern ${installation}`],
          ["TimeoutStartSec", String(BACKUP_ZEITLIMIT_S)],
        ],
      },
    ]),
    [BACKUP_TIMER]: unitText(kopf(installation), [
      { name: "Unit", zeilen: [["Description", `Backup ${installation} daily (Steuerzentrale)`]] },
      {
        name: "Timer",
        zeilen: [
          ["OnCalendar", "daily"],
          ["RandomizedDelaySec", "3600"],
          ["Persistent", "true"],
          ["Unit", BACKUP_SERVICE],
        ],
      },
      { name: "Install", zeilen: [["WantedBy", "timers.target"]] },
    ]),
  };
};

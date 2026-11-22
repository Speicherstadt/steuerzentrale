/*
 * The Linux user of an installation (docs/plan.md, "Einrichten auf dem Server"): `sz-<installation>`
 * with its home under /home, and how the agent (root) runs a fixed argv as that user: runuser with
 * `env -i` and a fixed environment, so no value of the agent's environment reaches the user's
 * processes and nothing is read by a shell. XDG_RUNTIME_DIR and the bus are what `systemctl --user`
 * and rootless Podman need (systemd's user manager, started by lingering).
 */

export type Nutzer = { name: string; uid: number; gid: number; home: string };

/** Reads a user from the system; undefined when there is none */
export type NutzerLesen = (name: string) => Promise<Nutzer | undefined>;

/** The Pforte's user, made by install.sh (docs/plan.md, "Nutzer und Unit der Pforte") */
export const PFORTE_NUTZER = "sz-pforte";

export const nutzerName = (installation: string): string => `sz-${installation}`;

/** The home useradd is told to create: a fixed path, never one read back from somewhere */
export const homeVon = (installation: string): string => `/home/${nutzerName(installation)}`;

export const PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export const laufzeitVerzeichnis = (n: Nutzer): string => `/run/user/${n.uid}`;

/** The user's D-Bus socket: there once systemd's user manager runs */
export const busSocket = (n: Nutzer): string => `${laufzeitVerzeichnis(n)}/bus`;

export const alsNutzer = (n: Nutzer, argv: readonly string[]): string[] => [
  "runuser",
  "-u",
  n.name,
  "--",
  "env",
  "-i",
  `HOME=${n.home}`,
  `USER=${n.name}`,
  `LOGNAME=${n.name}`,
  `PATH=${PATH}`,
  `XDG_RUNTIME_DIR=${laufzeitVerzeichnis(n)}`,
  `DBUS_SESSION_BUS_ADDRESS=unix:path=${busSocket(n)}`,
  ...argv,
];

/** The entry of a user in /etc/passwd (name:x:uid:gid:gecos:home:shell) */
export const passwdEintrag = (passwd: string, name: string): Nutzer | undefined => {
  for (const zeile of passwd.split("\n")) {
    const teile = zeile.split(":");
    if (teile.length < 7 || teile[0] !== name) continue;
    const uid = Number(teile[2]);
    const gid = Number(teile[3]);
    const home = teile[5] ?? "";
    if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || !home.startsWith("/"))
      return undefined;
    return { name, uid, gid, home };
  }
  return undefined;
};

/**
 * The users useradd makes are local, so /etc/passwd knows them; read on every call, since the agent
 * adds and removes users while it runs
 */
export const nutzerAusPasswd =
  (lesen: (pfad: string) => Promise<string | undefined>, pfad = "/etc/passwd"): NutzerLesen =>
  async (name) =>
    passwdEintrag((await lesen(pfad)) ?? "", name);

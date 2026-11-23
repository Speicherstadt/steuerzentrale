import { BOOT_ID } from "@steuerzentrale/manifest";
import type { FaktenQuellen } from "./quellen.ts";

/*
 * The operating system's own facts (BAULISTE.md Z-701; docs/plan.md, "Betriebssystem in den
 * Fakten"): the boot, which a reboot replaces, and unattended-upgrades, which install.sh sets up for
 * the security updates. Read from /proc, the file system and one command with a fixed argv; null
 * when unreadable.
 */

/** A random id the kernel makes at every boot (proc(5)) */
export const BOOT_ID_DATEI = "/proc/sys/kernel/random/boot_id";

/** The program of the package unattended-upgrades */
export const UNATTENDED_BINARY = "/usr/bin/unattended-upgrade";

/** apt.systemd.daily touches it after each run of unattended-upgrade */
export const UNATTENDED_STEMPEL = "/var/lib/apt/periodic/unattended-upgrades-stamp";

/** The whole apt configuration as apt puts it together from apt.conf.d (apt-config(8)) */
export const APT_CONFIG = ["apt-config", "dump"] as const;

const EINSCHALTER = /^APT::Periodic::Unattended-Upgrade "([^"]*)";$/m;

export const bootIdLesen = async (q: FaktenQuellen): Promise<string | null> => {
  const text = (await q.lesen(BOOT_ID_DATEI))?.trim() ?? "";
  return BOOT_ID.test(text) ? text : null;
};

/** `btime` of /proc/stat: the boot in seconds since the epoch (proc_stat(5)) */
export const gestartetAm = async (q: FaktenQuellen): Promise<number | null> => {
  const sekunden = /^btime (\d+)$/m.exec((await q.lesen("/proc/stat")) ?? "")?.[1];
  return sekunden === undefined ? null : Number(sekunden) * 1000;
};

/** On unless APT::Periodic::Unattended-Upgrade is "0" or missing (apt.systemd.daily) */
const eingeschaltet = async (q: FaktenQuellen): Promise<boolean | null> => {
  const lauf = await q.ausfuehren(APT_CONFIG, 10_000);
  if (lauf?.code !== 0) return null;
  const wert = EINSCHALTER.exec(lauf.aus)?.[1];
  return wert !== undefined && wert !== "" && wert !== "0";
};

export const unattendedUpgrades = async (
  q: FaktenQuellen,
): Promise<{ installiert: boolean; aktiv: boolean | null; letzterLauf: number | null }> => {
  if (!(await q.gibtEs(UNATTENDED_BINARY)))
    return { installiert: false, aktiv: false, letzterLauf: null };
  const [aktiv, letzterLauf] = await Promise.all([
    eingeschaltet(q),
    q.geaendertAm(UNATTENDED_STEMPEL),
  ]);
  return { installiert: true, aktiv, letzterLauf: letzterLauf ?? null };
};

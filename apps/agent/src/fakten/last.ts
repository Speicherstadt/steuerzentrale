import type { FaktenQuellen } from "./quellen.ts";

/*
 * CPU, load and memory (BAULISTE.md Z-1106), read from files only: the server's from /proc (proc(5):
 * the first `cpu` line of /proc/stat, the 1-minute load of /proc/loadavg, MemTotal minus MemAvailable
 * of /proc/meminfo) and each installation's from the cgroup of its Linux user
 * (`/sys/fs/cgroup/user.slice/user-<uid>.slice`: `memory.current` and `usage_usec` of `cpu.stat`,
 * cgroup v2). CPU is a share of the whole machine over the time since the previous reading: the
 * first reading has none, and counters that went back (a reboot) start anew; neither is ever 0.
 * Anything unreadable is null, never 0.
 */

export type CpuZaehler = { gesamt: number; leerlauf: number };

/** The first line `cpu …` of /proc/stat: all jiffies, and idle plus iowait */
export const cpuZaehlerLesen = (stat: string | undefined): CpuZaehler | null => {
  const zeile = stat?.split("\n").find((z) => /^cpu\s/.test(z));
  if (!zeile) return null;
  const werte = zeile.trim().split(/\s+/).slice(1, 9).map(Number);
  if (werte.length < 5 || werte.some((w) => !Number.isFinite(w) || w < 0)) return null;
  const [, , , idle = 0, iowait = 0] = werte;
  return { gesamt: werte.reduce((a, b) => a + b, 0), leerlauf: idle + iowait };
};

const runden = (wert: number) => Math.round(wert * 10) / 10;

/** The busy share between two readings in percent; null without a previous one or after a reboot */
export const cpuProzent = (alt: CpuZaehler | null, neu: CpuZaehler | null): number | null => {
  if (!alt || !neu || neu.gesamt <= alt.gesamt || neu.leerlauf < alt.leerlauf) return null;
  const gesamt = neu.gesamt - alt.gesamt;
  return runden(
    Math.min(100, Math.max(0, (100 * (gesamt - (neu.leerlauf - alt.leerlauf))) / gesamt)),
  );
};

/** The load of the last minute, the first field of /proc/loadavg */
export const lastLesen = (text: string | undefined): number | null => {
  const feld = text?.trim().split(/\s+/)[0] ?? "";
  const wert = Number(feld);
  return feld !== "" && Number.isFinite(wert) && wert >= 0 ? wert : null;
};

const kib = (text: string, name: string): number | undefined => {
  const zeile = text.split("\n").find((z) => z.startsWith(`${name}:`));
  const wert = Number.parseInt(zeile?.slice(name.length + 1).trim() ?? "", 10);
  return Number.isFinite(wert) && wert >= 0 ? wert : undefined;
};

/** MemTotal minus MemAvailable of /proc/meminfo (KiB) in MiB */
export const ramBelegtMb = (text: string | undefined): number | null => {
  if (text === undefined) return null;
  const gesamt = kib(text, "MemTotal");
  const frei = kib(text, "MemAvailable");
  if (gesamt === undefined || frei === undefined || frei > gesamt) return null;
  return Math.round((gesamt - frei) / 1024);
};

/** `usage_usec` of a cgroup's cpu.stat */
export const usageUsec = (text: string | undefined): number | null => {
  const zeile = text?.split("\n").find((z) => z.startsWith("usage_usec "));
  const wert = Number(zeile?.split(" ")[1]);
  return zeile && Number.isFinite(wert) && wert >= 0 ? wert : null;
};

/** `memory.current` (bytes) in MiB */
export const speicherMb = (text: string | undefined): number | null => {
  const wert = Number(text?.trim());
  return text !== undefined && text.trim() !== "" && Number.isFinite(wert) && wert >= 0
    ? Math.round(wert / 1024 / 1024)
    : null;
};

export type NutzerZaehler = { usec: number; am: number };

/** A user's share of the whole machine between two readings; null as for the server */
export const nutzerCpuProzent = (
  alt: NutzerZaehler | undefined,
  neu: NutzerZaehler | null,
  kerne: number | null,
): number | null => {
  if (!alt || !neu || !kerne || neu.am <= alt.am || neu.usec < alt.usec) return null;
  const moeglich = (neu.am - alt.am) * 1000 * kerne;
  return runden(Math.min(100, (100 * (neu.usec - alt.usec)) / moeglich));
};

export type NutzerLast = { name: string; cpuProzent: number | null; ramMb: number | null };

export type Last = {
  cpuProzent: number | null;
  last1: number | null;
  ramBelegtMb: number | null;
  nutzer: NutzerLast[];
};

const slice = (uid: number) => `/sys/fs/cgroup/user.slice/user-${uid}.slice`;

/**
 * A reader that keeps its previous counters between readings: the server's and each user's. Called
 * with the users to read now (name and uid) and the cores
 */
export const lastMesser = (q: FaktenQuellen) => {
  let cpuAlt: CpuZaehler | null = null;
  let nutzerAlt = new Map<string, NutzerZaehler>();
  return async (
    nutzer: readonly { name: string; uid: number }[],
    kerne: number | null,
    jetzt: number,
  ): Promise<Last> => {
    const cpu = cpuZaehlerLesen(await q.lesen("/proc/stat"));
    const cpuProz = cpuProzent(cpuAlt, cpu);
    cpuAlt = cpu;
    const neu = new Map<string, NutzerZaehler>();
    const je: NutzerLast[] = [];
    for (const n of nutzer) {
      const usec = usageUsec(await q.lesen(`${slice(n.uid)}/cpu.stat`));
      const zaehler = usec === null ? null : { usec, am: jetzt };
      if (zaehler) neu.set(n.name, zaehler);
      je.push({
        name: n.name,
        cpuProzent: nutzerCpuProzent(nutzerAlt.get(n.name), zaehler, kerne),
        ramMb: speicherMb(await q.lesen(`${slice(n.uid)}/memory.current`)),
      });
    }
    nutzerAlt = neu;
    return {
      cpuProzent: cpuProz,
      last1: lastLesen(await q.lesen("/proc/loadavg")),
      ramBelegtMb: ramBelegtMb(await q.lesen("/proc/meminfo")),
      nutzer: je,
    };
  };
};

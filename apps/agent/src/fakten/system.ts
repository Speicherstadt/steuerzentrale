import type { FaktenQuellen } from "./quellen.ts";

/*
 * The facts of the machine itself (BAULISTE.md Z-304): cores, RAM, architecture, operating system,
 * kernel and whether it waits for a reboot. Read from /proc, /etc and /boot; null when unreadable.
 */

/** The value of a `key: value` line, as /proc/cpuinfo and /proc/meminfo write them */
const zeilen = (text: string, schluessel: string) =>
  text
    .split("\n")
    .filter((zeile) => zeile.split(":")[0]?.trim() === schluessel)
    .map((zeile) => zeile.slice(zeile.indexOf(":") + 1).trim());

/** The processors the kernel lists (proc(5), /proc/cpuinfo) */
export const cpuKerne = async (q: FaktenQuellen): Promise<number | null> => {
  const text = await q.lesen("/proc/cpuinfo");
  const anzahl = text === undefined ? 0 : zeilen(text, "processor").length;
  return anzahl > 0 ? anzahl : null;
};

/** MemTotal of /proc/meminfo, which counts in KiB, in MiB */
export const ramMb = async (q: FaktenQuellen): Promise<number | null> => {
  const text = await q.lesen("/proc/meminfo");
  const kib = Number.parseInt(text === undefined ? "" : (zeilen(text, "MemTotal")[0] ?? ""), 10);
  return Number.isFinite(kib) && kib >= 1024 ? Math.floor(kib / 1024) : null;
};

const MASCHINEN: Record<string, "amd64" | "arm64"> = { x86_64: "amd64", aarch64: "arm64" };

export const architektur = (q: FaktenQuellen): "amd64" | "arm64" | null =>
  MASCHINEN[q.maschine()] ?? null;

/** One value of an os-release file, without its quotes (os-release(5)) */
const osWert = (text: string, schluessel: string): string | undefined => {
  const zeile = text.split("\n").find((z) => z.startsWith(`${schluessel}=`));
  return zeile
    ?.slice(schluessel.length + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
};

/** NAME and VERSION_ID; os-release(5) names /usr/lib/os-release as the fallback */
export const osLesen = async (
  q: FaktenQuellen,
): Promise<{ name: string; version: string } | null> => {
  const text = (await q.lesen("/etc/os-release")) ?? (await q.lesen("/usr/lib/os-release"));
  const name = text === undefined ? undefined : osWert(text, "NAME");
  if (text === undefined || !name) return null;
  return { name, version: osWert(text, "VERSION_ID") ?? "" };
};

const neuer = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true }) > 0;

/** The newest of the kernel versions in these names (`vmlinuz-<version>` or a bare version) */
export const neuesterKernel = (namen: string[]): string | null =>
  namen
    .map((name) => name.replace(/^vmlinuz-/, ""))
    .filter((version) => /^\d+\.\d+/.test(version))
    .reduce<string | null>((beste, v) => (beste === null || neuer(v, beste) ? v : beste), null);

export type Kernel = { laeuft: string | null; installiert: string | null };

/**
 * The running kernel (uname -r, which the kernel also gives in /proc/sys/kernel/osrelease) and the
 * newest installed one: its image in /boot, else its modules in /lib/modules
 */
export const kernel = async (q: FaktenQuellen): Promise<Kernel> => {
  const laeuft = (await q.lesen("/proc/sys/kernel/osrelease"))?.trim() || null;
  const boot = (await q.liste("/boot"))?.filter((name) => name.startsWith("vmlinuz-")) ?? [];
  const installiert =
    boot.length > 0 ? neuesterKernel(boot) : neuesterKernel((await q.liste("/lib/modules")) ?? []);
  return { laeuft, installiert };
};

/**
 * Whether the server waits for a reboot: Ubuntu's update-notifier and unattended-upgrades write
 * /var/run/reboot-required; Debian 13 does not without update-notifier-common, so a newer kernel
 * than the running one counts too
 */
export const neustartNoetig = async (q: FaktenQuellen, k: Kernel): Promise<boolean> => {
  if (await q.gibtEs("/var/run/reboot-required")) return true;
  return k.laeuft !== null && k.installiert !== null && neuer(k.installiert, k.laeuft);
};

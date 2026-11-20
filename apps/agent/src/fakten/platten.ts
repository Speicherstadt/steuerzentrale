import type { FaktenQuellen } from "./quellen.ts";

/*
 * Disks per mount point (BAULISTE.md Z-304): the writable file systems on a disk from /proc/mounts,
 * each measured with statfs(2). Placement reads the one that holds /home, where the installations'
 * users live; the checks of Z-702 read them all.
 */

const DATEISYSTEME = new Set(["ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs"]);

/** proc(5) escapes space, tab, newline and backslash in a path as three octal digits */
const entschluesseln = (pfad: string) =>
  pfad.replace(/\\([0-7]{3})/g, (_, oktal: string) =>
    String.fromCharCode(Number.parseInt(oktal, 8)),
  );

/**
 * The mount points worth measuring: writable disk file systems, and the root whatever it is (in a
 * container an overlay); snaps, tmpfs, Podman's overlays and read-only mounts hold no installation
 */
export const mountpunkte = (mounts: string): string[] => {
  const punkte = mounts.split("\n").flatMap((zeile) => {
    const [, pfad, typ, optionen] = zeile.split(" ");
    if (!pfad || !typ || !optionen) return [];
    const mount = entschluesseln(pfad);
    const schreibbar = optionen.split(",").includes("rw");
    return mount === "/" || (DATEISYSTEME.has(typ) && schreibbar) ? [mount] : [];
  });
  return [...new Set(punkte)];
};

export type Platte = { mount: string; gesamtMb: number; freiMb: number };

export const platten = async (q: FaktenQuellen): Promise<Platte[] | null> => {
  const mounts = await q.lesen("/proc/mounts");
  if (mounts === undefined) return null;
  const gemessen = await Promise.all(
    mountpunkte(mounts).map(async (mount) => {
      const platz = await q.platz(mount);
      return platz ? [{ mount, ...platz }] : [];
    }),
  );
  return gemessen.flat();
};

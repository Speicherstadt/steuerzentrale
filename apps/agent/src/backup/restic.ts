import { BACKUP_AUFBEWAHRUNG, type BackupTeil, RESTIC_IMAGE } from "@steuerzentrale/manifest";

/*
 * restic's argv (BAULISTE.md Z-601; docs/plan.md, "Backup auf dem Server"), checked against restic
 * v0.20.0: `podman run --rm` of the image by digest from system.ts in the installation's network,
 * so a run reaches S3 the way the installation does and nothing of another one. The password is
 * read from a file on descriptor 3 (RESTIC_PASSWORD_FILE, internal/global/global.go), the S3
 * access from an AWS credentials file on descriptor 4 (AWS_SHARED_CREDENTIALS_FILE, read by
 * internal/backend/s3/s3.go through minio-go): `--preserve-fds 2` hands both into the container,
 * so neither value stands in an argv, in the container's environment or in a file of the image.
 * `--host` is the installation, since a container's host name changes with every run and restic's
 * `forget` groups by it. Pure.
 */

/**
 * `installation` is the host of the snapshots; `netz` the network restic runs in, the
 * installation's own unless a Prüf-Restore plays its snapshots back into a copy (Z-602);
 * `inUnit` when restic runs within a transient unit of its own (restoring, Z-603): its container
 * then stays in that unit's cgroup (`--cgroups split`, as Quadlet runs a container: podman v4.9.3,
 * pkg/systemd/quadlet/quadlet.go), so stopping the unit ends conmon and restic too; without it,
 * conmon and the container run in a scope of their own and outlive whoever started them
 */
export type Repo = { installation: string; repository: string; netz?: string; inUnit?: boolean };

/** What restic reads on descriptors 3 and 4 */
export const PASSWORT_FD = "/dev/fd/3";
export const ZUGANG_FD = "/dev/fd/4";

const podmanRun = (r: Repo, o: { eingabe?: boolean; volume?: string } = {}): string[] => [
  "podman",
  "run",
  "--rm",
  ...(r.inUnit ? ["--cgroups", "split"] : []),
  ...(o.eingabe ? ["-i"] : []),
  "--network",
  r.netz ?? r.installation,
  "--preserve-fds",
  "2",
  "--env",
  `RESTIC_PASSWORD_FILE=${PASSWORT_FD}`,
  "--env",
  `AWS_SHARED_CREDENTIALS_FILE=${ZUGANG_FD}`,
  ...(o.volume === undefined ? [] : ["--volume", o.volume]),
  RESTIC_IMAGE.image,
  // the container is thrown away, and with it any cache
  "--no-cache",
  "--repo",
  r.repository,
];

/** One part: restic's argv and, for a dump or a command, the argv whose output it reads */
export const teilArgv = (r: Repo, t: BackupTeil): { restic: string[]; quelle?: string[] } => {
  const backup = ["backup", "--json", "--host", r.installation, "--tag", t.tag];
  if (t.art === "volume")
    return {
      restic: [...podmanRun(r, { volume: `${t.volume}:${t.pfad}:ro` }), ...backup, t.pfad],
    };
  return {
    quelle: ["podman", "exec", t.container, ...t.argv],
    restic: [
      ...podmanRun(r, { eingabe: true }),
      ...backup,
      "--stdin",
      "--stdin-filename",
      t.dateiname,
    ],
  };
};

/** The retention of docs/plan.md, per part (its tag) of this installation, then pruned */
export const forgetArgv = (r: Repo): string[] => [
  ...podmanRun(r),
  "forget",
  "--host",
  r.installation,
  "--group-by",
  "host,tags",
  "--keep-daily",
  String(BACKUP_AUFBEWAHRUNG.taeglich),
  "--keep-weekly",
  String(BACKUP_AUFBEWAHRUNG.woechentlich),
  "--keep-monthly",
  String(BACKUP_AUFBEWAHRUNG.monatlich),
  "--prune",
];

/** `cat config` answers 10 when there is no repository (doc/075_scripting.rst), then `init` */
export const anlegenArgv = (r: Repo, schritt: "pruefen" | "init"): string[] => [
  ...podmanRun(r),
  ...(schritt === "pruefen" ? ["cat", "config"] : ["init"]),
];

/** A snapshot of a source that failed is not kept: it would look like a whole one */
export const verwerfenArgv = (r: Repo, snapshot: string): string[] => [
  ...podmanRun(r),
  "forget",
  snapshot,
];

/**
 * The newest snapshot of a part, or the one given (Z-603), and the entries of one folder in it
 * (Z-602): `ls --json` prints the snapshot first, then the folder and what is directly in it (not
 * recursive, cmd/restic/cmd_ls.go). A snapshot given by its ID is found without `--host` and
 * `--tag` (internal/data/snapshot_find.go, FindLatest), so its host and tags are checked from that
 * first line (pruef-restore/spielen.ts, lsLesen)
 */
export const lsArgv = (r: Repo, tag: string, ordner: string, snapshot?: string): string[] => [
  ...podmanRun(r),
  "ls",
  "--json",
  ...(snapshot === undefined ? ["latest", "--host", r.installation, "--tag", tag] : [snapshot]),
  ordner,
];

/**
 * A file of a snapshot as it is, or a folder as tar: `<snapshot>:<folder>` makes the folder the
 * root of the archive, so its entries are relative to it (doc/050_restore.rst, "dump")
 */
export const dumpArgv = (r: Repo, snapshot: string, datei: string, tar: boolean): string[] => [
  ...podmanRun(r),
  "dump",
  ...(tar ? ["--archive", "tar", `${snapshot}:${datei}`, "/"] : [snapshot, datei]),
];

/** The AWS credentials file of the S3 access; its form is checked by backupAuftragPruefen */
export const zugangIni = (z: { schluesselId: string; geheim: string }): string =>
  `[default]\naws_access_key_id = ${z.schluesselId}\naws_secret_access_key = ${z.geheim}\n`;

/** The snapshot of `backup --json`: the ID in its summary (doc/075_scripting.rst, "backup") */
export const snapshotAus = (aus: string): string | undefined => {
  for (const zeile of aus.split("\n")) {
    try {
      const n = JSON.parse(zeile) as { message_type?: unknown; snapshot_id?: unknown };
      if (
        n.message_type === "summary" &&
        typeof n.snapshot_id === "string" &&
        /^[0-9a-f]{64}$/.test(n.snapshot_id)
      )
        return n.snapshot_id;
    } catch {
      // a line that is no JSON
    }
  }
  return undefined;
};

/**
 * What restic read for a part: `total_bytes_processed` of the summary of `backup --json`
 * (doc/075_scripting.rst, "backup"), the storage of the Leistungen (Z-804); none in other output
 */
export const bytesAus = (aus: string): number | undefined => {
  for (const zeile of aus.split("\n")) {
    try {
      const n = JSON.parse(zeile) as { message_type?: unknown; total_bytes_processed?: unknown };
      const b = n.total_bytes_processed;
      if (
        n.message_type === "summary" &&
        typeof b === "number" &&
        Number.isSafeInteger(b) &&
        b >= 0
      )
        return b;
    } catch {
      // a line that is no JSON
    }
  }
  return undefined;
};

/** The reason for an exit code by restic's table (doc/075_scripting.rst, "Exit codes"), no output */
export const resticGrund = (code: number | null): string => {
  if (code === 12) return "falsches Passwort des Repositorys";
  if (code === 10) return "das Repository fehlt";
  if (code === 11) return "das Repository ist gesperrt";
  if (code === 3) return "die Quelle wurde nicht vollständig gelesen";
  if (code === null) return "restic wurde beendet";
  return `restic endete mit Code ${code}`;
};

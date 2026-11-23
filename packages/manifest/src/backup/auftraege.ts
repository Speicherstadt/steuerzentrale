import { befehlFuellen, befehlZurAktion } from "../befehl.ts";
import { INSTALLATIONS_NAME } from "../quadlet/eingabe.ts";
import type { Manifest } from "../schema.ts";

/*
 * The backup jobs (BAULISTE.md Z-601; docs/plan.md, "Backup auf dem Server"): built into the
 * Steuerzentrale like the setup jobs, with a fixed shape. `installation_backup_einrichten` carries
 * the installation's restic repository, its S3 access and its restic password (field `backup`) and
 * resolves the parts of the signed manifest's `backup` into what the agent runs: a volume by its
 * Podman name, a dump or command by its container and argv from `befehle`; never anything from the
 * job itself. `installation_backup` ("Backup jetzt") carries nothing. Pure: the Zentrale checks a
 * job with it when it makes one, the agent again after key and signature.
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name these */
export const BACKUP_AKTIONEN = {
  einrichten: "installation_backup_einrichten",
  jetzt: "installation_backup",
} as const;

/** One run at most: the service's limit; `sichern` stops a little earlier to write its result */
export const BACKUP_ZEITLIMIT_S = 4 * 3600;

/** Writing the files, pulling restic and `init`; restic retries an unreachable S3 for 15 minutes */
export const BACKUP_EINRICHTEN_ZEITLIMIT_S = 1800;

/** docs/plan.md, "Backups": 7 daily, 4 weekly, 6 monthly snapshots of each part */
export const BACKUP_AUFBEWAHRUNG = { taeglich: 7, woechentlich: 4, monatlich: 6 } as const;

/** Where the volume of a part is mounted, read-only, in restic's container */
export const SICHERUNG_PFAD = "/sicherung";

/** What the Zentrale gives one installation (packages/protokoll, `Backup`) */
export type BackupZugang = {
  repository: string;
  zugang: { schluesselId: string; geheim: string };
  passwort: string;
};

/** A part of the manifest's `backup` as the agent runs it, with its restic tag */
export type BackupTeil =
  | { art: "volume"; tag: string; volume: string; pfad: string }
  | {
      art: "pg_dump" | "befehl";
      tag: string;
      /** The container's name, `<installation>-<container>` as its Quadlet unit names it */
      container: string;
      argv: string[];
      /** The name of the file in the snapshot (`restic backup --stdin-filename`) */
      dateiname: string;
      /** A command's own time limit (`zeitlimit_s`) */
      zeitlimitS?: number | undefined;
    };

export type BackupAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, unknown>>;
  einrichtung?: unknown;
  backup?: BackupZugang | undefined;
};

export type BackupAuftrag =
  | { art: "einrichten"; name: string; teile: BackupTeil[]; zugang: BackupZugang }
  | { art: "jetzt"; name: string };

export type BackupGeprueft = { ok: true; auftrag: BackupAuftrag } | { ok: false; grund: string };

export const istBackupAktion = (aktion: string): boolean =>
  Object.values<string>(BACKUP_AKTIONEN).includes(aktion);

/**
 * Only S3 (restic's other backends start programs, `rclone` and `sftp`, or write locally), with
 * host, bucket and prefix of plain characters and no user or password in the address
 */
const REPOSITORY = /^s3:https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._-]+)+$/;
/**
 * The access goes into an AWS credentials file (restic's AWS_SHARED_CREDENTIALS_FILE), read as INI:
 * no line break, no space, no `;` or `#`, which would end the value there
 */
const ZUGANG_ID = /^[A-Za-z0-9+/=._~-]{3,128}$/;
const ZUGANG_GEHEIM = /^[A-Za-z0-9+/=._~-]{8,128}$/;
/** restic reads the password file whole and trims spaces and line breaks at both ends */
const PASSWORT = /^[\x21-\x7e][\x20-\x7e]{14,498}[\x21-\x7e]$/;
/** A part's tag and file name: restic splits `--tag` at commas */
const DATENBANK = /^[A-Za-z0-9_.-]{1,63}$/;

const zugangBefunde = (z: BackupZugang): string[] => [
  ...(REPOSITORY.test(z.repository)
    ? []
    : ["backup.repository: an S3 repository (s3:https://<host>/<bucket>/<prefix>)"]),
  ...(ZUGANG_ID.test(z.zugang.schluesselId) && ZUGANG_GEHEIM.test(z.zugang.geheim)
    ? []
    : ["backup.zugang: key ID and secret of letters, digits and + / = . _ ~ -"]),
  ...(PASSWORT.test(z.passwort)
    ? []
    : ["backup.passwort: 16 to 500 printable ASCII characters, no space at either end"]),
];

/** `<installation>-<teil>`: the names its Quadlet units give volumes and containers (container.ts) */
const podmanName = (installation: string, teil: string): string => `${installation}-${teil}`;

type TeileGeprueft = { ok: true; teile: BackupTeil[] } | { ok: false; grund: string };

const teil = (
  m: Manifest,
  name: string,
  t: Manifest["backup"][number],
  i: number,
): BackupTeil | string => {
  if (t.art === "volume")
    return {
      art: "volume",
      tag: `volume:${t.volume}`,
      volume: podmanName(name, t.volume),
      pfad: `${SICHERUNG_PFAD}/${t.volume}`,
    };
  if (t.art === "pg_dump") {
    if (!DATENBANK.test(t.datenbank))
      return `backup.${i}.datenbank: letters, digits, _ . - (it names the part's tag)`;
    return {
      art: "pg_dump",
      tag: `pg_dump:${t.container}:${t.datenbank}`,
      container: podmanName(name, t.container),
      // -U and -d take the next word whatever it is, so neither is read as an option
      argv: ["pg_dump", "-Fc", "-U", t.nutzer, "-d", t.datenbank],
      dateiname: `${t.container}-${t.datenbank}.dump`,
    };
  }
  const befehl = befehlZurAktion(m, t.befehl);
  const gefuellt = befehl ? befehlFuellen(befehl, {}) : undefined;
  if (!befehl || !gefuellt?.ok)
    return `backup.${i}: befehl ${t.befehl} must be a command without arguments`;
  return {
    art: "befehl",
    tag: `befehl:${t.befehl}`,
    container: podmanName(name, befehl.container),
    argv: gefuellt.argv,
    dateiname: t.befehl,
    ...(befehl.zeitlimit_s === undefined ? {} : { zeitlimitS: befehl.zeitlimit_s }),
  };
};

/** The parts of the signed manifest's `backup` for the installation, in their order */
export const backupTeile = (m: Manifest, name: string): TeileGeprueft => {
  if (m.backup.length === 0) return { ok: false, grund: "the manifest names no backup part" };
  const teile: BackupTeil[] = [];
  for (const [i, t] of m.backup.entries()) {
    const r = teil(m, name, t, i);
    if (typeof r === "string") return { ok: false, grund: r };
    teile.push(r);
  }
  return { ok: true, teile };
};

const nein = (grund: string): BackupGeprueft => ({ ok: false, grund });

export const backupAuftragPruefen = (m: Manifest, a: BackupAnfrage): BackupGeprueft => {
  if (!istBackupAktion(a.aktion)) return nein(`${a.aktion} is not a backup job`);
  const name = a.installationId;
  if (name === null || !INSTALLATIONS_NAME.test(name))
    return nein("a backup belongs to a named installation");
  const fremd = Object.keys(a.argumente);
  if (fremd.length > 0) return nein(`unknown argument ${fremd.join(", ")}`);
  if (a.einrichtung !== undefined) return nein("a backup job takes no installation data");
  if (a.aktion === BACKUP_AKTIONEN.jetzt)
    return a.backup === undefined
      ? { ok: true, auftrag: { art: "jetzt", name } }
      : nein("backing up now carries no backup data");
  if (a.backup === undefined) return nein("setting up a backup needs the backup data (backup)");
  const befunde = zugangBefunde(a.backup);
  if (befunde.length > 0) return nein(befunde.join("; "));
  const teile = backupTeile(m, name);
  if (!teile.ok) return teile;
  return { ok: true, auftrag: { art: "einrichten", name, teile: teile.teile, zugang: a.backup } };
};

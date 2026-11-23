import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupPolicy, RESTIC_IMAGE } from "@steuerzentrale/manifest";
import { dienstkontoAnlegen } from "../../zentrale/src/modules/backups/minio.ts";
import { sha256Hex, signieren } from "../../zentrale/src/modules/backups/sigv4.ts";
import { zugangErzeugen } from "../../zentrale/src/modules/backups/zugaenge.ts";
import { hostIp, type Lauf, lauf, muss } from "./pforte-hilfen.ts";

/*
 * Helpers of the backup test with real Podman, systemd and MinIO (CI only, Z-601): MinIO in a
 * container of the runner, the agent's binary built and installed where the user's service finds
 * it, and restic as the runner to look into the repository and to add snapshots of an old time.
 * An installation's own access is made by the Zentrale's admin client (modules/backups/minio.ts)
 * with the policy of packages/manifest; S3 requests are signed by the Zentrale's SigV4.
 */

/**
 * MinIO for the tests: the official images left Docker Hub in 2025 and quay.io is not reachable
 * from the agents' sandbox, so Bitnami's last build of MinIO (RELEASE 2025-07-23), its "legacy"
 * repository. `bun scripts/digest.ts docker.io/bitnamilegacy/minio:2025.7.23` on 2026-11-23. Its
 * own variables: MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, MINIO_DEFAULT_BUCKETS (bitnami/containers,
 * bitnami/minio/README.md). Never on a managed server.
 */
export const MINIO_IMAGE =
  "docker.io/bitnamilegacy/minio@sha256:8935e75fa5d11295c17171e4aa49efe390a1193cd7f12e4d21b92af9ffef09d7";
export const MINIO_PORT = 29401;
export const BUCKET = "sicherung";
export const ADMIN = { schluesselId: "szadmin", geheim: `szadmin-${crypto.randomUUID()}` };
/** The test MinIO has no region set, so it signs in its default one, as restic assumes too */
const REGION = "us-east-1";
const AM_RUNNER = `http://127.0.0.1:${MINIO_PORT}`;

export type S3Schluessel = { schluesselId: string; geheim: string };

const sudo = (...argv: string[]) => muss(["sudo", "-n", ...argv]);

export type Minio = {
  /** The S3 endpoint as an installation's container reaches it: the runner's address */
  fuerInstallation: string;
  stoppen: () => void;
};

export const minioStarten = async (name: string): Promise<Minio> => {
  muss([
    "podman",
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-p",
    `${MINIO_PORT}:9000`,
    "-e",
    `MINIO_ROOT_USER=${ADMIN.schluesselId}`,
    "-e",
    `MINIO_ROOT_PASSWORD=${ADMIN.geheim}`,
    "-e",
    `MINIO_DEFAULT_BUCKETS=${BUCKET}`,
    MINIO_IMAGE,
  ]);
  for (let i = 0; i < 120; i++) {
    const bereit = await fetch(`http://127.0.0.1:${MINIO_PORT}/minio/health/ready`)
      .then((r) => r.status === 200)
      .catch(() => false);
    if (bereit)
      return {
        fuerInstallation: `http://${hostIp()}:${MINIO_PORT}`,
        stoppen: () => void lauf(["podman", "rm", "-f", name]),
      };
    await Bun.sleep(1000);
  }
  throw new Error(`MinIO did not start: ${lauf(["podman", "logs", name]).fehler}`);
};

/** The agent's binary for this machine, where a user's service may run it; removed by `weg` */
export const agentInstallieren = (ziel: string): { pfad: string; weg: () => void } => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-agent-"));
  try {
    const gebaut = join(ordner, "agent");
    muss(
      [
        "bun",
        "build",
        "--compile",
        join(import.meta.dirname, "../src/main.ts"),
        "--outfile",
        gebaut,
      ],
      300_000,
    );
    sudo("install", "-m", "0755", "-o", "root", "-g", "root", "--", gebaut, ziel);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
  return { pfad: ziel, weg: () => void lauf(["sudo", "-n", "rm", "-f", "--", ziel]) };
};

/** restic as the runner on the host's network, with the admin access or another; values only in its environment */
export const resticAlsRunner = (
  repository: string,
  passwort: string,
  args: string[],
  eingabe?: string,
  zugang: S3Schluessel = ADMIN,
): Lauf => {
  const l = Bun.spawnSync(
    [
      "podman",
      "run",
      "--rm",
      "-i",
      "--network",
      "host",
      "-e",
      "RESTIC_PASSWORD",
      "-e",
      "AWS_ACCESS_KEY_ID",
      "-e",
      "AWS_SECRET_ACCESS_KEY",
      RESTIC_IMAGE.image,
      "--no-cache",
      "--repo",
      repository,
      ...args,
    ],
    {
      cwd: "/",
      timeout: 300_000,
      stdin: eingabe === undefined ? "ignore" : Buffer.from(eingabe),
      env: {
        ...process.env,
        RESTIC_PASSWORD: passwort,
        AWS_ACCESS_KEY_ID: zugang.schluesselId,
        AWS_SECRET_ACCESS_KEY: zugang.geheim,
      },
    },
  );
  return { code: l.exitCode ?? -1, aus: l.stdout.toString(), fehler: l.stderr.toString() };
};

export type Snapshot = {
  id: string;
  time: string;
  hostname: string;
  tags?: string[];
  paths: string[];
};

/** The repository's snapshots, as `snapshots --json` lists them */
export const snapshots = (repository: string, passwort: string): Snapshot[] => {
  const l = resticAlsRunner(repository, passwort, ["snapshots", "--json"]);
  if (l.code !== 0) throw new Error(`restic snapshots ended with ${l.code}: ${l.fehler}`);
  return JSON.parse(l.aus) as Snapshot[];
};

/**
 * An installation's own access to the prefix, made as the Zentrale makes it: a service account
 * under the admin with `backupPolicy`, through `add-service-account`, keys from `zugangErzeugen`
 */
export const zugangAnlegen = async (name: string, praefix: string): Promise<S3Schluessel> => {
  const { accessKey, secretKey } = zugangErzeugen();
  const r = await dienstkontoAnlegen(
    {
      fetch,
      endpunkt: AM_RUNNER,
      region: REGION,
      admin: { accessKey: ADMIN.schluesselId, secretKey: ADMIN.geheim },
      jetzt: Date.now,
    },
    {
      zugang: { accessKey, secretKey },
      policy: backupPolicy(BUCKET, praefix),
      name,
      beschreibung: `test ${name}`,
    },
  );
  if (!r.ok) throw new Error(`add-service-account for ${name}: ${r.fehler}`);
  return { schluesselId: accessKey, geheim: secretKey };
};

/** A request to the bucket without a body, signed with the access by the Zentrale's SigV4 */
export const s3Anfrage = async (
  zugang: S3Schluessel,
  methode: "GET" | "DELETE",
  pfad: string,
  abfrage: Record<string, string> = {},
): Promise<{ status: number; text: string }> => {
  const url = new URL(`${AM_RUNNER}/${BUCKET}${pfad}`);
  for (const [k, v] of Object.entries(abfrage)) url.searchParams.set(k, v);
  const koepfe = await signieren({
    methode,
    url,
    inhaltHash: await sha256Hex(new Uint8Array(0)),
    zugang: { accessKey: zugang.schluesselId, secretKey: zugang.geheim },
    region: REGION,
    jetzt: Date.now(),
  });
  const a = await fetch(url, { method: methode, headers: koepfe });
  return { status: a.status, text: await a.text() };
};

/** The keys of the objects below the prefix (ListObjectsV2, one page), as the access sees them */
export const objekte = async (praefix: string, zugang: S3Schluessel = ADMIN): Promise<string[]> => {
  const a = await s3Anfrage(zugang, "GET", "/", { "list-type": "2", prefix: praefix });
  if (a.status !== 200) throw new Error(`ListObjectsV2 ${praefix}: HTTP ${a.status} ${a.text}`);
  if (a.text.includes("<IsTruncated>true</IsTruncated>"))
    throw new Error(`ListObjectsV2 ${praefix}: more than one page`);
  return [...a.text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] as string).sort();
};

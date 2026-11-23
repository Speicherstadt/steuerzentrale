import { INSTALLATIONS_NAME } from "./quadlet/eingabe.ts";

/*
 * Where an installation's backups lie on the operator's S3 target and what its own access may do
 * there (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und Zugang je Installation (Z-601)"): one restic
 * repository per installation under `s3://<bucket>/<operator>/<installation>/`, and a policy that
 * lets the installation's access read, write and delete there and nowhere else. Pure: the Zentrale
 * gives the policy to MinIO's `add-service-account`, the agent's CI test checks it against MinIO.
 * Policy language: AWS IAM, as MinIO reads it (actions `s3:*Object`, `s3:ListBucket` with the
 * condition key `s3:prefix`; https://min.io/docs/minio/linux/administration/identity-access-management/policy-based-access-control.html).
 */

/** An operator's id (a UUID in Better Auth) and an installation's name: no `*`, `?` or `/` */
const BETREIBER = /^[A-Za-z0-9-]{1,64}$/;

/** A bucket name as S3 allows it (lower case, digits, dots, hyphens; 3 to 63) */
export const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export type BackupOrt = { bucket: string; betreiberId: string; installationId: string };

export type OrtGeprueft = { ok: true; praefix: string } | { ok: false; grund: string };

/** The installation's prefix in the bucket, ending in `/`, so no other name starts with it */
export const backupPraefix = (o: BackupOrt): OrtGeprueft => {
  if (!BUCKET.test(o.bucket)) return { ok: false, grund: "bucket: not a valid bucket name" };
  if (!BETREIBER.test(o.betreiberId)) return { ok: false, grund: "betreiberId: not a plain id" };
  if (!INSTALLATIONS_NAME.test(o.installationId))
    return { ok: false, grund: "installationId: not an installation's name" };
  return { ok: true, praefix: `${o.betreiberId}/${o.installationId}/` };
};

/** The restic repository of an installation: `s3:<endpoint>/<bucket>/<prefix without the slash>` */
export const backupRepository = (endpunkt: string, bucket: string, praefix: string): string =>
  `s3:${endpunkt.replace(/\/+$/, "")}/${bucket}/${praefix.replace(/\/$/, "")}`;

type Anweisung = {
  Effect: "Allow";
  Action: string[];
  Resource: string[];
  Condition?: Record<string, Record<string, string[]>>;
};
export type BackupPolicy = { Version: "2012-10-17"; Statement: Anweisung[] };

/**
 * The installation's access: list the bucket only below its prefix, and read, write and delete
 * objects only there. restic needs nothing else for `init`, `backup`, `forget --prune`, `check` and
 * `restore`; an access denied on the bucket itself it takes as "the bucket exists"
 */
export const backupPolicy = (bucket: string, praefix: string): BackupPolicy => ({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["s3:ListBucket"],
      Resource: [`arn:aws:s3:::${bucket}`],
      Condition: { StringLike: { "s3:prefix": [praefix, `${praefix}*`] } },
    },
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      Resource: [`arn:aws:s3:::${bucket}/${praefix}*`],
    },
  ],
});

import { describe, expect, it } from "vitest";
import {
  type BackupPolicy,
  backupPolicy,
  backupPraefix,
  backupRepository,
} from "./backup-zugang.ts";

/*
 * BAULISTE.md Z-601: the S3 access of an installation reaches only its own prefix. The policy is
 * checked here as data, with a small evaluator of the IAM rules it uses (Allow, `Action`,
 * `Resource` with a trailing `*`, `StringLike` on `s3:prefix`). Against a real MinIO the CI checks
 * it in apps/agent/test/backup.agent.test.ts: two accesses made by the Zentrale's admin client with
 * this policy; one backs up into its own repository, but reading, deleting or listing the other's
 * prefix or the prefix above is denied, and the other's objects stay as they were.
 */

type Anfrage = { aktion: string; bucket: string; objekt?: string; prefix?: string };

const passt = (muster: string, wert: string) =>
  muster.endsWith("*") ? wert.startsWith(muster.slice(0, -1)) : muster === wert;

/** Whether some statement allows the request; everything not allowed is denied */
const erlaubt = (p: BackupPolicy, a: Anfrage): boolean =>
  p.Statement.some((s) => {
    if (!s.Action.includes(a.aktion)) return false;
    const ressource = `arn:aws:s3:::${a.bucket}${a.objekt === undefined ? "" : `/${a.objekt}`}`;
    if (!s.Resource.some((r) => passt(r, ressource))) return false;
    const bedingung = s.Condition?.StringLike?.["s3:prefix"];
    return bedingung === undefined || bedingung.some((m) => passt(m, a.prefix ?? ""));
  });

const praefix = (installationId: string) => {
  const p = backupPraefix({ bucket: "backups", betreiberId: "b1", installationId });
  if (!p.ok) throw new Error(p.grund);
  return p.praefix;
};

describe("the prefix of an installation", () => {
  it("is <operator>/<installation>/, ending in a slash", () => {
    expect(praefix("haben-abc123")).toBe("b1/haben-abc123/");
  });

  it("refuses names that could widen it", () => {
    for (const [betreiberId, installationId, bucket] of [
      ["b*", "haben-abc123", "backups"],
      ["b1", "haben-*", "backups"],
      ["b1/b2", "haben-abc123", "backups"],
      ["b1", "haben-abc123", "Backups"],
      ["b1", "../x", "backups"],
    ] as const)
      expect(backupPraefix({ betreiberId, installationId, bucket }).ok).toBe(false);
  });

  it("makes the restic repository from endpoint, bucket and prefix", () => {
    expect(backupRepository("https://s3.example.de/", "backups", "b1/haben-abc123/")).toBe(
      "s3:https://s3.example.de/backups/b1/haben-abc123",
    );
  });
});

describe("the policy of an installation's access", () => {
  const eigen = praefix("haben-abc");
  const p = backupPolicy("backups", eigen);
  const objekt = (o: string) => (aktion: string) => ({ aktion, bucket: "backups", objekt: o });

  it("lets it read, write and delete below its own prefix and list it", () => {
    for (const aktion of ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
      expect(erlaubt(p, objekt(`${eigen}data/ab/abcdef`)(aktion)), aktion).toBe(true);
    for (const prefix of [eigen, `${eigen}snapshots/`])
      expect(erlaubt(p, { aktion: "s3:ListBucket", bucket: "backups", prefix })).toBe(true);
  });

  it("denies another installation's prefix, also one that starts with the same name", () => {
    for (const fremd of ["b1/haben-abcd/config", "b1/kontext-x/config", "b2/haben-abc/config"])
      for (const aktion of ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
        expect(erlaubt(p, objekt(fremd)(aktion)), `${aktion} ${fremd}`).toBe(false);
    for (const prefix of ["", "b1/", "b1/haben-abcd/", "b2/haben-abc/"])
      expect(erlaubt(p, { aktion: "s3:ListBucket", bucket: "backups", prefix }), prefix).toBe(
        false,
      );
  });

  it("denies another bucket and every other action", () => {
    expect(erlaubt(p, { aktion: "s3:GetObject", bucket: "andere", objekt: `${eigen}config` })).toBe(
      false,
    );
    for (const aktion of ["s3:DeleteBucket", "s3:PutBucketPolicy", "s3:*", "admin:*"])
      expect(erlaubt(p, objekt(`${eigen}config`)(aktion)), aktion).toBe(false);
    const aktionen = p.Statement.flatMap((s) => s.Action).sort();
    expect(aktionen).toEqual(["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"]);
    expect(p.Statement.every((s) => s.Effect === "Allow")).toBe(true);
  });
});

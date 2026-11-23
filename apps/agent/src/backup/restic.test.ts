import { RESTIC_IMAGE } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import {
  anlegenArgv,
  bytesAus,
  forgetArgv,
  resticGrund,
  snapshotAus,
  teilArgv,
  verwerfenArgv,
  zugangIni,
} from "./restic.ts";

/*
 * BAULISTE.md Z-601: restic as the agent runs it, a fixed argv without a shell (docs/plan.md,
 * "Backup auf dem Server"; restic v0.20.0, internal/global/global.go and doc/075_scripting.rst):
 * `podman run --rm` of the image by digest in the installation's network; the password from a file
 * on descriptor 3 (RESTIC_PASSWORD_FILE) and the S3 access from one on descriptor 4
 * (AWS_SHARED_CREDENTIALS_FILE), so neither stands in an argv or the container's environment.
 */
const REPO = { installation: "test-x", repository: "s3:http://10.0.2.2:29400/sicherung/test-x" };

const kopf = (eingabe: boolean, volume: string[] = []) => [
  "podman",
  "run",
  "--rm",
  ...(eingabe ? ["-i"] : []),
  "--network",
  "test-x",
  "--preserve-fds",
  "2",
  "--env",
  "RESTIC_PASSWORD_FILE=/dev/fd/3",
  "--env",
  "AWS_SHARED_CREDENTIALS_FILE=/dev/fd/4",
  ...volume,
  RESTIC_IMAGE.image,
  "--no-cache",
  "--repo",
  REPO.repository,
];

describe("teilArgv", () => {
  it("backs up a volume mounted read-only, with the installation as host and the part's tag", () => {
    expect(
      teilArgv(REPO, {
        art: "volume",
        tag: "volume:daten",
        volume: "test-x-daten",
        pfad: "/sicherung/daten",
      }),
    ).toEqual({
      restic: [
        ...kopf(false, ["--volume", "test-x-daten:/sicherung/daten:ro"]),
        "backup",
        "--json",
        "--host",
        "test-x",
        "--tag",
        "volume:daten",
        "/sicherung/daten",
      ],
    });
  });

  it("pipes a command's output from its container into restic's standard input", () => {
    expect(
      teilArgv(REPO, {
        art: "befehl",
        tag: "befehl:export",
        container: "test-x-app",
        argv: ["bun", "/app/server.ts", "export"],
        dateiname: "export",
      }),
    ).toEqual({
      quelle: ["podman", "exec", "test-x-app", "bun", "/app/server.ts", "export"],
      restic: [
        ...kopf(true),
        "backup",
        "--json",
        "--host",
        "test-x",
        "--tag",
        "befehl:export",
        "--stdin",
        "--stdin-filename",
        "export",
      ],
    });
  });

  it("pipes pg_dump in custom format alike", () => {
    const r = teilArgv(REPO, {
      art: "pg_dump",
      tag: "pg_dump:db:beispiel",
      container: "test-x-db",
      argv: ["pg_dump", "-Fc", "-U", "beispiel", "-d", "beispiel"],
      dateiname: "db-beispiel.dump",
    });
    expect(r.quelle).toEqual([
      "podman",
      "exec",
      "test-x-db",
      "pg_dump",
      "-Fc",
      "-U",
      "beispiel",
      "-d",
      "beispiel",
    ]);
    expect(r.restic.slice(-5)).toEqual([
      "--tag",
      "pg_dump:db:beispiel",
      "--stdin",
      "--stdin-filename",
      "db-beispiel.dump",
    ]);
  });
});

describe("the other commands", () => {
  it("forgets by 7 daily, 4 weekly, 6 monthly per part of this installation, and prunes", () => {
    expect(forgetArgv(REPO)).toEqual([
      ...kopf(false),
      "forget",
      "--host",
      "test-x",
      "--group-by",
      "host,tags",
      "--keep-daily",
      "7",
      "--keep-weekly",
      "4",
      "--keep-monthly",
      "6",
      "--prune",
    ]);
  });

  it("asks for the repository's config before it creates one", () => {
    expect(anlegenArgv(REPO, "pruefen")).toEqual([...kopf(false), "cat", "config"]);
    expect(anlegenArgv(REPO, "init")).toEqual([...kopf(false), "init"]);
  });

  it("forgets a snapshot whose source failed", () => {
    expect(verwerfenArgv(REPO, "a".repeat(64))).toEqual([...kopf(false), "forget", "a".repeat(64)]);
  });
});

describe("zugangIni", () => {
  it("writes the access as an AWS credentials file", () => {
    expect(zugangIni({ schluesselId: "SZ01", geheim: "geheim+/=" })).toBe(
      "[default]\naws_access_key_id = SZ01\naws_secret_access_key = geheim+/=\n",
    );
  });
});

describe("snapshotAus", () => {
  it("takes the snapshot of restic's summary", () => {
    const aus = [
      '{"message_type":"status","percent_done":1}',
      `{"message_type":"summary","files_new":1,"snapshot_id":"${"c".repeat(64)}"}`,
      "",
    ].join("\n");
    expect(snapshotAus(aus)).toBe("c".repeat(64));
  });

  it("finds none in other output", () => {
    expect(snapshotAus("kein json\n{}")).toBeUndefined();
    expect(snapshotAus('{"message_type":"summary","snapshot_id":"kurz"}')).toBeUndefined();
  });
});

describe("bytesAus", () => {
  it("takes the bytes restic read from its summary", () => {
    const aus = [
      '{"message_type":"status","total_bytes":5}',
      `{"message_type":"summary","total_bytes_processed":1048576,"snapshot_id":"${"c".repeat(64)}"}`,
    ].join("\n");
    expect(bytesAus(aus)).toBe(1_048_576);
  });

  it("finds none in other output or a value that is no size", () => {
    expect(bytesAus("kein json\n{}")).toBeUndefined();
    expect(bytesAus('{"message_type":"summary","total_bytes_processed":-1}')).toBeUndefined();
    expect(bytesAus('{"message_type":"summary","total_bytes_processed":"12"}')).toBeUndefined();
    expect(bytesAus('{"message_type":"status","total_bytes_processed":12}')).toBeUndefined();
  });
});

describe("resticGrund", () => {
  it.each([
    [12, "falsches Passwort des Repositorys"],
    [10, "das Repository fehlt"],
    [11, "das Repository ist gesperrt"],
    [3, "die Quelle wurde nicht vollständig gelesen"],
    [1, "restic endete mit Code 1"],
    [null, "restic wurde beendet"],
  ])("names exit code %s by restic's table", (code, grund) => {
    expect(resticGrund(code)).toBe(grund);
  });
});

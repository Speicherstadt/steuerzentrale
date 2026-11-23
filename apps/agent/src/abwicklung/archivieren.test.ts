import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupPolicy } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { dienstkontoAnlegen } from "../../../zentrale/src/modules/backups/minio.ts";
import { minioNachbau, TEST_ADMIN } from "../../../zentrale/src/testhilfen/minio.ts";
import type { BackupDatei } from "../backup/datei.ts";
import type { ResticAufruf } from "../backup/sichern.ts";
import { speicher } from "../beitritt/testhilfen.ts";
import { type ArchivDeps, archivierenBefehl, repositoryOrt } from "./archivieren.ts";

/*
 * BAULISTE.md Z-604, `archivieren` as the installation's user against the stand-in of MinIO
 * (signatures and the prefix of a service account's policy checked as MinIO does): the newest
 * snapshot of each part goes into a file of the user's, up with the installation's own access to
 * `<prefix>archiv/`, and the file is removed; another installation's prefix is refused; never as
 * root; nothing of the access in the answer.
 */

const minio = minioNachbau();
const ordner = mkdtempSync(join(tmpdir(), "sz-test-archiv-"));
afterAll(() => {
  minio.stoppen();
  rmSync(ordner, { recursive: true, force: true });
});

const NAME = "beispiel-x7k2p9";
const HOME = "/home/sz-beispiel-x7k2p9";
const ZUGANG = { accessKey: "szarchivtest000000001", secretKey: "geheimnis-des-archivs-0815" };

const datei = (praefix: string): BackupDatei => ({
  installation: NAME,
  repository: `s3:${minio.url}/backups/${praefix.replace(/\/$/, "")}`,
  zugang: { schluesselId: ZUGANG.accessKey, geheim: ZUGANG.secretKey },
  passwort: "restic-passwort-der-installation",
  teile: [
    { art: "volume", tag: "volume:daten", volume: `${NAME}-daten`, pfad: "/sicherung/daten" },
    {
      art: "befehl",
      tag: "befehl:export",
      container: `${NAME}-app`,
      argv: ["bun", "/app/server.ts", "export"],
      dateiname: "export",
    },
  ],
});

const umgebung = async (d: BackupDatei, uid = 1001) => {
  await dienstkontoAnlegen(
    { fetch, endpunkt: minio.url, region: minio.region, admin: TEST_ADMIN, jetzt: Date.now },
    {
      zugang: ZUGANG,
      policy: backupPolicy("backups", "b-1/beispiel-x7k2p9/"),
      name: "sz-test",
      beschreibung: "test",
    },
  );
  const s = speicher();
  await s.dateien.schreiben(`${HOME}/.config/steuerzentrale/backup.json`, JSON.stringify(d), 0o600);
  const aufrufe: ResticAufruf[] = [];
  const deps: ArchivDeps = {
    uid: () => uid,
    home: () => HOME,
    dateien: s.dateien,
    restic: async (a) => {
      aufrufe.push(a);
      if (a.datei) writeFileSync(a.datei, `inhalt von ${a.argv.join(" ")}`);
      return { code: 0, aus: "" };
    },
    jetzt: Date.now,
    ordner: async () => ordner,
    groesse: async (p) => Bun.file(p).size,
    hochladen: async (url, p, koepfe) =>
      (await fetch(url, { method: "PUT", headers: koepfe, body: Bun.file(p) })).status,
    entfernen: async (p) => rmSync(p, { force: true }),
  };
  return { deps, aufrufe };
};

describe("archivieren", () => {
  it("uploads the newest snapshot of each part beside the repository and removes its files", async () => {
    const { deps, aufrufe } = await umgebung(datei("b-1/beispiel-x7k2p9/"));
    const r = await archivierenBefehl([NAME, minio.region], deps);
    expect(r.code).toBe(0);
    const antwort = JSON.parse(r.out);
    expect(antwort.objekte.map((o: { datei: string }) => o.datei)).toEqual([
      "volume-daten.tar",
      "befehl-export-export",
    ]);
    expect(minio.objekte.has("backups/b-1/beispiel-x7k2p9/archiv/volume-daten.tar")).toBe(true);
    expect(aufrufe[0]?.argv.slice(-9)).toEqual([
      "dump",
      "--host",
      NAME,
      "--tag",
      "volume:daten",
      "--archive",
      "tar",
      "latest:/sicherung/daten",
      "/",
    ]);
    expect(aufrufe[1]?.argv.slice(-2)).toEqual(["latest", "/export"]);
    expect(existsSync(join(ordner, "volume-daten.tar"))).toBe(false);
    expect(r.out).not.toContain(ZUGANG.secretKey);
  });

  it("is refused outside the installation's own prefix", async () => {
    const { deps } = await umgebung(datei("b-1/andere-inst01/"));
    const r = await archivierenBefehl([NAME, minio.region], deps);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).grund).toMatch(/upload HTTP 403/);
  });

  it("never runs as root and takes only a name and a region", async () => {
    const { deps } = await umgebung(datei("b-1/beispiel-x7k2p9/"), 0);
    expect((await archivierenBefehl([NAME, minio.region], deps)).code).toBe(1);
    expect((await archivierenBefehl([NAME, "EU 1"], deps)).code).toBe(2);
    expect((await archivierenBefehl(["../x", "eu"], deps)).code).toBe(2);
  });

  it("takes the repository apart", () => {
    expect(repositoryOrt("s3:https://s3.example.org/sicherung/b-1/inst")).toEqual({
      endpunkt: "https://s3.example.org",
      bucket: "sicherung",
      praefix: "b-1/inst/",
    });
    expect(repositoryOrt("/srv/restic")).toBeUndefined();
  });
});

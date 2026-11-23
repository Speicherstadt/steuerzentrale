import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beispielManifest } from "../quadlet/testeingabe.ts";
import { RESTIC_IMAGE } from "../system.ts";
import {
  BACKUP_AKTIONEN,
  type BackupAnfrage,
  type BackupZugang,
  backupAuftragPruefen,
  backupTeile,
  istBackupAktion,
} from "./auftraege.ts";

/*
 * BAULISTE.md Z-601 (docs/plan.md, "Backup auf dem Server"): two built-in jobs with a fixed shape,
 * checked by Zentrale and agent with one function. Setting up carries the installation's
 * repository, S3 access and restic password and resolves the parts of the signed manifest's
 * `backup`; backing up now carries nothing. Neither carries an argv: a command comes from `befehle`.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");
const beispiel = beispielManifest(VORLAGE);
const NAME = "beispiel-x7k2p9";

const ZUGANG: BackupZugang = {
  repository: "s3:https://s3.example.org/sicherung/b-1/beispiel-x7k2p9",
  zugang: { schluesselId: "SZBEISPIEL0000000001", geheim: "c2VjcmV0LXNjaGx1ZXNzZWw+/=" },
  passwort: "restic-passwort-der-installation",
};

const einrichten = (teil: Partial<BackupAnfrage> = {}): BackupAnfrage => ({
  aktion: BACKUP_AKTIONEN.einrichten,
  installationId: NAME,
  argumente: {},
  backup: ZUGANG,
  ...teil,
});

const grund = (r: { ok: boolean; grund?: string }) => (r.ok ? "ok" : r.grund);

const mitBackup = (backup: string) =>
  beispielManifest(VORLAGE.replace(/^backup:\n(\s+- .*\n)+/m, `backup:\n${backup}\n`));

describe("the backup jobs", () => {
  it("are named with an underscore, which no command of a manifest has", () => {
    expect(BACKUP_AKTIONEN).toEqual({
      einrichten: "installation_backup_einrichten",
      jetzt: "installation_backup",
    });
    expect(istBackupAktion("installation_backup")).toBe(true);
    expect(istBackupAktion("export")).toBe(false);
  });

  it("restic runs by digest", () => {
    expect(RESTIC_IMAGE.image).toMatch(/^docker\.io\/restic\/restic@sha256:[0-9a-f]{64}$/);
  });
});

describe("backupTeile", () => {
  it("resolves the example app's volume and command from the signed manifest", () => {
    expect(backupTeile(beispiel, NAME)).toEqual({
      ok: true,
      teile: [
        {
          art: "volume",
          tag: "volume:daten",
          volume: `${NAME}-daten`,
          pfad: "/sicherung/daten",
        },
        {
          art: "befehl",
          tag: "befehl:export",
          container: `${NAME}-app`,
          argv: ["bun", "/app/server.ts", "export"],
          dateiname: "export",
        },
      ],
    });
  });

  it("dumps a database with pg_dump in custom format, its user and database as words", () => {
    const m = mitBackup(
      "  - { art: pg_dump, container: app, datenbank: beispiel, nutzer: beispiel-nutzer }",
    );
    expect(backupTeile(m, NAME)).toEqual({
      ok: true,
      teile: [
        {
          art: "pg_dump",
          tag: "pg_dump:app:beispiel",
          container: `${NAME}-app`,
          argv: ["pg_dump", "-Fc", "-U", "beispiel-nutzer", "-d", "beispiel"],
          dateiname: "app-beispiel.dump",
        },
      ],
    });
  });

  it("refuses a database name that cannot be a tag", () => {
    const m = mitBackup("  - { art: pg_dump, container: app, datenbank: 'a,b', nutzer: n }");
    expect(grund(backupTeile(m, NAME))).toContain("backup.0.datenbank");
  });

  it("keeps a command's time limit and refuses a command that wants arguments", () => {
    const lang = VORLAGE.replace(
      "export: { container: app, argv: [bun, /app/server.ts, export] }",
      "export: { container: app, argv: [bun, /app/server.ts, export], zeitlimit_s: 600 }",
    );
    const r = backupTeile(beispielManifest(lang), NAME);
    expect(r.ok && r.teile[1]).toMatchObject({ zeitlimitS: 600 });
    const mitArgument = VORLAGE.replace(
      "export: { container: app, argv: [bun, /app/server.ts, export] }",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's placeholder, not JavaScript's
      'export: { container: app, argv: [bun, /app/server.ts, "${arg:was}"], argumente: { was: { typ: text, muster: "[a-z]+" } } }',
    );
    expect(grund(backupTeile(beispielManifest(mitArgument), NAME))).toContain("befehl export");
  });

  it("refuses a manifest without backup parts", () => {
    const ohne = beispielManifest(VORLAGE.replace(/^backup:\n(\s+- .*\n)+/m, ""));
    expect(grund(backupTeile(ohne, NAME))).toBe("the manifest names no backup part");
  });
});

describe("backupAuftragPruefen", () => {
  it("sets up with the parts and the access the job carries", () => {
    const r = backupAuftragPruefen(beispiel, einrichten());
    expect(r).toMatchObject({ ok: true, auftrag: { art: "einrichten", name: NAME } });
    expect(r.ok && r.auftrag.art === "einrichten" && r.auftrag.zugang).toEqual(ZUGANG);
  });

  it("backs up now without anything else", () => {
    expect(
      backupAuftragPruefen(beispiel, {
        aktion: BACKUP_AKTIONEN.jetzt,
        installationId: NAME,
        argumente: {},
      }),
    ).toEqual({ ok: true, auftrag: { art: "jetzt", name: NAME } });
    expect(
      grund(
        backupAuftragPruefen(
          beispiel,
          einrichten({ aktion: BACKUP_AKTIONEN.jetzt, backup: ZUGANG }),
        ),
      ),
    ).toBe("backing up now carries no backup data");
  });

  it.each([
    ["no installation", { installationId: null }, "a backup belongs to a named installation"],
    ["an installation named like an option", { installationId: "-x" }, "named installation"],
    ["arguments", { argumente: { a: "b" } }, "unknown argument a"],
    ["installation data", { einrichtung: {} }, "takes no installation data"],
    ["no backup data", { backup: undefined }, "needs the backup data"],
    ["another job", { aktion: "export" }, "export is not a backup job"],
  ])("refuses %s", (_was, teil, erwartet) => {
    expect(grund(backupAuftragPruefen(beispiel, einrichten(teil)))).toContain(erwartet);
  });

  it.each([
    ["another backend of restic", "sftp:user@host:/srv/restic"],
    ["rclone, which starts a program", "rclone:remote:pfad"],
    ["a local path", "/srv/restic"],
    ["no bucket", "s3:https://s3.example.org"],
    ["a space", "s3:https://s3.example.org/sicherung /x"],
    ["user and password in the address", "s3:https://a:b@s3.example.org/sicherung"],
  ])("refuses a repository with %s", (_was, repository) => {
    expect(
      grund(backupAuftragPruefen(beispiel, einrichten({ backup: { ...ZUGANG, repository } }))),
    ).toContain("backup.repository");
  });

  it("takes MinIO over HTTP in a network of its own, as in CI", () => {
    const repository = "s3:http://10.0.2.2:29400/sicherung/b-1/test-x";
    expect(
      backupAuftragPruefen(beispiel, einrichten({ backup: { ...ZUGANG, repository } })),
    ).toMatchObject({ ok: true });
  });

  it.each([
    [
      "a key ID with a newline",
      { schluesselId: "AB\naws_session_token = x", geheim: "g".repeat(20) },
    ],
    ["a secret with a comment sign", { schluesselId: "SZ01", geheim: "geheim#mehr0000" }],
    ["a short secret", { schluesselId: "SZ01", geheim: "kurz" }],
  ])("refuses access with %s, which the credentials file cannot hold", (_was, zugang) => {
    expect(
      grund(backupAuftragPruefen(beispiel, einrichten({ backup: { ...ZUGANG, zugang } }))),
    ).toContain("backup.zugang");
  });

  it.each([
    ["short", "zu-kurz"],
    ["with a line break", `${"x".repeat(20)}\n${"y".repeat(20)}`],
    ["with a space at its end", `${"x".repeat(20)} `],
  ])("refuses a password that is %s", (_was, passwort) => {
    expect(
      grund(backupAuftragPruefen(beispiel, einrichten({ backup: { ...ZUGANG, passwort } }))),
    ).toContain("backup.passwort");
  });

  it("names no value of the access or the password in a reason", () => {
    const zugang = { schluesselId: "SZ01", geheim: "geheim#mehr0000" };
    const passwort = "passwort mit\nzeile und mehr";
    const r = grund(backupAuftragPruefen(beispiel, einrichten({ backup: { ...ZUGANG, zugang } })));
    const p = grund(
      backupAuftragPruefen(beispiel, einrichten({ backup: { ...ZUGANG, passwort } })),
    );
    expect(`${r}${p}`).not.toContain("geheim#mehr");
    expect(`${r}${p}`).not.toContain("passwort mit");
  });
});

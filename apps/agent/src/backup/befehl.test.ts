import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { SICHERN_USAGE, type SichernBefehlDeps, sichernBefehl } from "./befehl.ts";
import type { BackupDatei } from "./datei.ts";
import type { ResticAntwort, ResticAufruf } from "./sichern.ts";

/*
 * BAULISTE.md Z-601, `steuerzentrale-agent sichern`: only as the installation's user and only from
 * its own backup.json; each run appended to backup-stand.json, at most 14, written atomically with
 * 0600; a failed run is a failed stand and exit code 1; nothing printed names the password or the
 * access.
 */
const HOME = "/home/sz-test-x";
const DATEI_PFAD = `${HOME}/.config/steuerzentrale/backup.json`;
const STAND_PFAD = `${HOME}/.config/steuerzentrale/backup-stand.json`;
const PASSWORT = "restic-passwort-der-installation";
const GEHEIM = "s3-geheimnis-0815";

const DATEI: BackupDatei = {
  installation: "test-x",
  repository: "s3:http://10.0.2.2:29400/sicherung/test-x",
  zugang: { schluesselId: "SZ01", geheim: GEHEIM },
  passwort: PASSWORT,
  teile: [{ art: "volume", tag: "volume:daten", volume: "test-x-daten", pfad: "/sicherung/daten" }],
};

const aufgebaut = (
  o: {
    uid?: number;
    datei?: string;
    antwort?: (a: ResticAufruf) => ResticAntwort;
    stand?: string;
  } = {},
) => {
  const fs = speicher({
    ...(o.datei === undefined
      ? { [DATEI_PFAD]: JSON.stringify(DATEI) }
      : { [DATEI_PFAD]: o.datei }),
    ...(o.stand === undefined ? {} : { [STAND_PFAD]: o.stand }),
  });
  let n = 0;
  const deps: SichernBefehlDeps = {
    uid: () => o.uid ?? 2000,
    home: () => HOME,
    dateien: fs.dateien,
    sichern: {
      restic: async (a) =>
        o.antwort?.(a) ?? {
          code: 0,
          aus: `{"message_type":"summary","snapshot_id":"${"d".repeat(64)}"}`,
        },
      jetzt: () => 1_800_000_000_000,
      id: () => `lauf-${++n}`,
      planen: () => () => {},
    },
  };
  const stand = () => JSON.parse(fs.inhalt.get(STAND_PFAD)?.text ?? "null");
  return { deps, fs, stand };
};

describe("sichern", () => {
  it("backs up, appends the run to the stand file with 0600 and exits with 0", async () => {
    const a = aufgebaut();
    const r = await sichernBefehl(["test-x"], a.deps);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ msg: "backup", lauf: "lauf-1", ok: true });
    expect(a.stand()).toEqual({
      laeufe: [
        {
          lauf: "lauf-1",
          beginn: 1_800_000_000_000,
          ende: 1_800_000_000_000,
          ok: true,
          teile: [{ tag: "volume:daten", ok: true, snapshot: "d".repeat(64) }],
        },
      ],
    });
    expect(a.fs.inhalt.get(STAND_PFAD)?.modus).toBe(0o600);
  });

  it("writes a failed run as a failed stand and exits with 1, printing no secret", async () => {
    const a = aufgebaut({ antwort: () => ({ code: 12, aus: `Fatal ${PASSWORT}` }) });
    const r = await sichernBefehl(["test-x"], a.deps);
    expect(r.code).toBe(1);
    expect(a.stand().laeufe[0]).toMatchObject({
      ok: false,
      fehler: "volume:daten: falsches Passwort des Repositorys",
    });
    expect(r.out).not.toContain(PASSWORT);
    expect(r.out).not.toContain(GEHEIM);
    expect(JSON.stringify(a.stand())).not.toContain(PASSWORT);
  });

  it("keeps the last 14 runs and starts a broken stand file anew", async () => {
    const a = aufgebaut();
    for (let i = 0; i < 16; i++) await sichernBefehl(["test-x"], a.deps);
    expect(a.stand().laeufe.map((l: { lauf: string }) => l.lauf)).toEqual(
      Array.from({ length: 14 }, (_, i) => `lauf-${i + 3}`),
    );
    const kaputt = aufgebaut({ stand: "{kaputt" });
    await sichernBefehl(["test-x"], kaputt.deps);
    expect(kaputt.stand().laeufe).toHaveLength(1);
  });

  it("refuses to run as root", async () => {
    const a = aufgebaut({ uid: 0 });
    const r = await sichernBefehl(["test-x"], a.deps);
    expect(r).toEqual({
      code: 1,
      out: JSON.stringify({
        msg: "refusing to back up",
        grund: "sichern runs as the installation's user",
      }),
    });
    expect(a.stand()).toBeNull();
  });

  it("refuses a backup.json of another installation, a broken or a missing one", async () => {
    const fremd = await sichernBefehl(["test-y"], aufgebaut().deps);
    expect(JSON.parse(fremd.out).grund).toBe(`${DATEI_PFAD} is not the backup of test-y`);
    const kaputt = await sichernBefehl(["test-x"], aufgebaut({ datei: "{" }).deps);
    expect(kaputt.code).toBe(1);
  });

  it.each([
    [[]],
    [["-x"]],
    [["test-x", "--anders"]],
    [["test-x", "extra", "--repository-anlegen"]],
  ])("prints its usage for %j", async (args) => {
    expect(await sichernBefehl(args, aufgebaut().deps)).toEqual({ code: 2, out: SICHERN_USAGE });
  });
});

describe("sichern --repository-anlegen", () => {
  it("creates the repository and writes no stand", async () => {
    const a = aufgebaut({
      antwort: (x) => ({ code: x.argv.at(-1) === "config" ? 10 : 0, aus: "" }),
    });
    const r = await sichernBefehl(["test-x", "--repository-anlegen"], a.deps);
    expect(r).toEqual({
      code: 0,
      out: JSON.stringify({ msg: "repository", ok: true, repository: "angelegt" }),
    });
    expect(a.stand()).toBeNull();
  });

  it("fails with restic's reason", async () => {
    const a = aufgebaut({ antwort: () => ({ code: 12, aus: "" }) });
    const r = await sichernBefehl(["test-x", "--repository-anlegen"], a.deps);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toEqual({
      msg: "repository",
      ok: false,
      grund: "Repository: falsches Passwort des Repositorys",
    });
  });
});

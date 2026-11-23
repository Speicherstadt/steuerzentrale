import { BACKUP_AKTIONEN, type BackupZugang } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import { abbauen } from "../src/einrichtung/abbauen.ts";
import {
  eingerichtet,
  einrichtenAuftrag,
  einrichtungsAgent,
  HOME,
  NAME,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import type { Aufgerufen } from "../src/einrichtung/testsystem.ts";
import { aktionsManifest } from "./aktionen-hilfen.ts";
import { signiert } from "./einrichtung-hilfen.ts";

/*
 * BAULISTE.md Z-601, the agent's side of the backup jobs (docs/plan.md, "Backup auf dem Server"),
 * on a server in memory (testsystem.ts): only for an installation this agent set up and finished,
 * from the manifest its units were rendered from; backup.json written as root with 0600 and owned
 * by the user, the user's timer and service, the repository created by the agent's binary as the
 * user; "Backup jetzt" starts the user's service and reports the run's stand. No value of the
 * repository's password or the S3 access in an argv, a result, the record or the agent's log.
 */
const PASSWORT = "restic-passwort-der-installation";
const GEHEIM = "s3-geheimnis-0815-abc";
const ZUGANG: BackupZugang = {
  repository: "s3:https://s3.example.org/sicherung/b-1/beispiel-x7k2p9",
  zugang: { schluesselId: "SZBEISPIEL0000000001", geheim: GEHEIM },
  passwort: PASSWORT,
};
const KONFIG = `${HOME}/.config/steuerzentrale`;
const USER_UNITS = `${HOME}/.config/systemd/user`;

const backupEinrichten = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "b1",
    aktion: BACKUP_AKTIONEN.einrichten,
    einrichtung: undefined,
    backup: ZUGANG,
    ...teil,
  });

const backupJetzt = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "j1",
    aktion: BACKUP_AKTIONEN.jetzt,
    einrichtung: undefined,
    zeitlimitS: 600,
    ...teil,
  });

/** A server with the installation set up by a job, and the agent */
const eingerichteterAgent = async (scheitern?: (l: Aufgerufen) => number | undefined) => {
  let nachher = false;
  const a = einrichtungsAgent({ scheitern: (l) => (nachher ? scheitern?.(l) : undefined) });
  await a.empfangen();
  expect(a.ergebnis()).toMatchObject({ ok: true });
  nachher = true;
  return a;
};

const ohneGeheimnis = (a: Awaited<ReturnType<typeof eingerichteterAgent>>) => {
  const alles = JSON.stringify([a.sys.laeufe, a.gesendet, a.logs, a.record()]);
  expect(alles).not.toContain(PASSWORT);
  expect(alles).not.toContain(GEHEIM);
};

describe("installation_backup_einrichten", () => {
  it("writes backup.json as root with 0600, owned by the user, with the parts of the manifest", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(backupEinrichten());
    expect(a.ergebnis()).toEqual({
      ok: true,
      daten: {
        installation: NAME,
        repository: "angelegt",
        teile: ["volume:daten", "befehl:export"],
        timer: "sz_backup.timer",
      },
    });
    const n = a.sys.nutzer.get(NUTZER);
    const datei = a.sys.dateien.get(`${KONFIG}/backup.json`);
    expect(datei).toMatchObject({ art: "datei", modus: 0o600, uid: n?.uid, gid: n?.gid });
    expect(a.sys.dateien.get(KONFIG)).toMatchObject({ modus: 0o700, uid: n?.uid });
    expect(JSON.parse(datei?.inhalt ?? "")).toEqual({
      installation: NAME,
      ...ZUGANG,
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
  });

  it("writes the user's timer and service and enables the timer as the user", async () => {
    const a = await eingerichteterAgent();
    const vorher = a.sys.laeufe.length;
    await a.empfangen(backupEinrichten());
    const service = a.sys.dateien.get(`${USER_UNITS}/sz_backup.service`);
    expect(service?.inhalt).toContain(
      `ExecStart=/usr/local/bin/steuerzentrale-agent sichern ${NAME}`,
    );
    expect(service).toMatchObject({ modus: 0o600, uid: a.sys.nutzer.get(NUTZER)?.uid });
    expect(a.sys.dateien.get(`${USER_UNITS}/sz_backup.timer`)?.inhalt).toContain(
      "OnCalendar=daily",
    );
    expect(a.programme().slice(vorher)).toEqual([
      `${NUTZER}: systemctl --user daemon-reload`,
      `${NUTZER}: systemctl --user enable`,
      `${NUTZER}: /usr/local/bin/steuerzentrale-agent sichern`,
    ]);
    expect(a.sys.laeufe.at(-2)?.argv).toEqual([
      "systemctl",
      "--user",
      "enable",
      "--now",
      "sz_backup.timer",
    ]);
    expect(a.sys.laeufe.at(-1)?.argv).toEqual([
      "/usr/local/bin/steuerzentrale-agent",
      "sichern",
      NAME,
      "--repository-anlegen",
    ]);
  });

  it("puts no value of password or access in an argv, a result, the record or its log", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(backupEinrichten());
    await a.empfangen(backupJetzt());
    ohneGeheimnis(a);
  });

  it("is set up again with new values, as a job sent twice", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(backupEinrichten());
    const neu = { ...ZUGANG, passwort: "ein-anderes-passwort-0815" };
    await a.empfangen(backupEinrichten({ auftragId: "b2", backup: neu }));
    expect(a.ergebnis()).toMatchObject({ ok: true });
    expect(a.sys.dateien.get(`${KONFIG}/backup.json`)?.inhalt).toContain("ein-anderes-passwort");
  });

  it("fails with the reason of sichern when the repository cannot be created", async () => {
    const a = einrichtungsAgent({
      ausgabe: (l) =>
        l.argv[1] === "sichern"
          ? '{"msg":"repository","ok":false,"grund":"Repository: falsches Passwort des Repositorys"}\n'
          : undefined,
      scheitern: (l) => (l.argv[1] === "sichern" ? 1 : undefined),
    });
    await a.empfangen();
    await a.empfangen(backupEinrichten());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "Backup einrichten: Repository: falsches Passwort des Repositorys",
    });
  });

  it("refuses an installation this agent did not finish, and one it does not know", async () => {
    const angelegt = einrichtungsAgent({ anfang: eingerichtet({ [NAME]: "angelegt" }) });
    await angelegt.empfangen(backupEinrichten());
    expect(angelegt.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
    });
    const fremd = einrichtungsAgent();
    await fremd.empfangen(backupEinrichten());
    expect(fremd.ergebnis()).toMatchObject({ ok: false });
    expect(fremd.sys.unter(HOME)).toEqual([]);
  });

  it("refuses the backup of a manifest the installation's units were not rendered from", async () => {
    const a = await eingerichteterAgent();
    const anders = aktionsManifest(undefined, "9.9.9");
    await a.empfangen(backupEinrichten({ manifest: anders, signatur: signiert(anders) }));
    expect(a.ergebnis()).toMatchObject({ ok: false });
    expect((a.ergebnis() as { fehler: string }).fehler).toContain("9.9.9");
    expect(a.sys.dateien.has(`${KONFIG}/backup.json`)).toBe(false);
  });

  it("refuses a folder for backup.json that is not one, and writes nothing through it", async () => {
    const a = await eingerichteterAgent();
    const n = a.sys.nutzer.get(NUTZER);
    a.sys.dateien.set(KONFIG, { art: "datei", inhalt: "", modus: 0o600, uid: n?.uid ?? 0, gid: 0 });
    await a.empfangen(backupEinrichten());
    expect(a.ergebnis()).toMatchObject({ ok: false });
    expect((a.ergebnis() as { fehler: string }).fehler).toContain("is not a folder");
  });

  it("refuses a job without backup data, and backup data in any other job", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(backupEinrichten({ backup: undefined }));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: setting up a backup needs the backup data (backup)",
    });
    await a.empfangen(backupJetzt({ auftragId: "j9", backup: ZUGANG }));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: only installation_backup_einrichten carries backup data (backup)",
    });
    await a.empfangen(einrichtenAuftrag({ auftragId: "e9", backup: ZUGANG }));
    expect(a.ergebnis()).toMatchObject({ ok: false });
  });

  it("goes with the installation's home when it is torn down (userdel --remove)", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(backupEinrichten());
    expect(a.sys.unter(HOME)).toContain(`${KONFIG}/backup.json`);
    const weg = await abbauen(
      {
        ...a.sys,
        spawn: a.sys.spawn,
        lesen: a.sys.lesen,
        nutzer: a.sys.nutzerLesen,
        planen: () => () => {},
        warten: async () => {},
      },
      NAME,
      [],
    );
    expect(weg).toEqual({ ok: true });
    expect(a.sys.unter(HOME)).toEqual([]);
  });
});

describe("installation_backup", () => {
  const stand = (ok: boolean) =>
    JSON.stringify({
      laeufe: [
        {
          lauf: "alt",
          beginn: 1_700_000_000_000,
          ende: 1_700_000_001_000,
          ok: true,
          teile: [],
        },
        {
          lauf: "l-1",
          beginn: 1_800_000_000_000,
          ende: 1_800_000_000_000,
          ok,
          ...(ok ? {} : { fehler: "volume:daten: falsches Passwort des Repositorys" }),
          teile: [{ tag: "volume:daten", ok, ...(ok ? { snapshot: "e".repeat(64) } : {}) }],
        },
      ],
    });

  /** The run writes its stand when the service is started, as sichern does */
  const mitLauf = async (ok: boolean, systemctl = 0) => {
    const a = await eingerichteterAgent((l) => {
      if (l.argv[2] === "start" && l.argv[3] === "sz_backup.service") {
        const n = a.sys.nutzer.get(NUTZER);
        a.sys.dateien.set(`${KONFIG}/backup-stand.json`, {
          art: "datei",
          inhalt: stand(ok),
          modus: 0o600,
          uid: n?.uid ?? 0,
          gid: n?.gid ?? 0,
        });
        return systemctl;
      }
      return undefined;
    });
    await a.empfangen(backupEinrichten());
    return a;
  };

  it("starts the user's service, waits for it and reports its run", async () => {
    const a = await mitLauf(true);
    await a.empfangen(backupJetzt());
    expect(a.sys.laeufe.find((l) => l.argv[3] === "sz_backup.service")).toMatchObject({
      als: NUTZER,
      argv: ["systemctl", "--user", "start", "sz_backup.service"],
    });
    expect(a.ergebnis()).toEqual({
      ok: true,
      daten: {
        installation: NAME,
        lauf: "l-1",
        teile: [{ tag: "volume:daten", ok: true, snapshot: "e".repeat(64) }],
      },
    });
  });

  it("fails with the reason of a failed run", async () => {
    const a = await mitLauf(false, 3);
    await a.empfangen(backupJetzt());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "Backup gescheitert: volume:daten: falsches Passwort des Repositorys",
    });
  });

  it("fails when the service ended without a stand", async () => {
    const a = await eingerichteterAgent((l) => (l.argv[3] === "sz_backup.service" ? 1 : undefined));
    await a.empfangen(backupEinrichten());
    await a.empfangen(backupJetzt());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "Backup gescheitert: systemctl --user start: endete mit Code 1",
    });
  });

  it("refuses an installation whose backup is not set up", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(backupJetzt());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: das Backup von ${NAME} ist nicht eingerichtet`,
    });
  });
});

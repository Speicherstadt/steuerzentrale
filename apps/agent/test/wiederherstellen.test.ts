import { describe, expect, it } from "vitest";
import { MANIFEST, NAME, NUTZER } from "../src/einrichtung/testauftraege.ts";
import { type Aufgerufen, imBinary } from "../src/einrichtung/testsystem.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import { eingerichtet, GEHEIM, PASSWORT, ZUGANG } from "./pruef-restore-hilfen.ts";
import {
  alsInstallation,
  daten,
  MIT_DB,
  mitDbWiederherstellen,
  SNAPSHOT_A,
  SNAPSHOT_B,
  systemctl,
  TRANSIENT,
  UNIT_APP,
  UNIT_DB,
  VOLUME_UNIT,
  wiederherstellen,
  ZEITLIMIT_S,
} from "./wiederherstellen-hilfen.ts";

/*
 * BAULISTE.md Z-603, the agent's side of restoring (docs/plan.md, "Wiederherstellen auf dem Server
 * (Z-603)"), on a server in memory (testsystem.ts): the backup's timer stopped, the units stopped
 * as far as the parts need, each volume emptied (removed and made anew by its unit), each part
 * played back with the job's snapshot by the agent's binary as the installation's user in a
 * transient unit of that user (`systemd-run --user --wait --collect` with `RuntimeMaxSec`), then
 * all units started, active, healthy, and the timer started again. No value of the backup's access
 * is in an argv, a result, the record or the agent's log.
 */

const BACKUP_TIMER = "sz_backup.timer";

describe("installation_wiederherstellen", () => {
  it("empties the volume and plays the job's snapshot back into it, then starts and checks the installation", async () => {
    const geholt: string[] = [];
    const a = await eingerichtet({
      installationen: {
        holen: async (url) => {
          geholt.push(url);
          return new Response(null, { status: 200 });
        },
      },
    });
    await a.empfangen(wiederherstellen());
    const d = daten(a);
    expect(d.teile).toEqual([
      { tag: "volume:daten", snapshot: SNAPSHOT_A, zurueckgespielt: true, grund: null },
      {
        tag: "befehl:export",
        snapshot: null,
        zurueckgespielt: false,
        grund: "die Ausgabe eines Befehls ist ein Export, kein Restore",
      },
    ]);
    expect(d.dauerMs).toBeGreaterThanOrEqual(0);
    expect(geholt).toEqual(["http://127.0.0.1:20001/health"]);
    const ablauf = alsInstallation(a).map((l) => imBinary(l.argv).slice(0, 5).join(" "));
    expect(ablauf).toEqual([
      `systemctl --user stop ${BACKUP_TIMER}`,
      "systemctl --user is-active --quiet sz_backup.service",
      `systemctl --user stop ${UNIT_APP}`,
      `podman volume rm --force ${NAME}-daten`,
      `systemctl --user restart ${VOLUME_UNIT}`,
      `systemctl --user start ${NAME}-network.service ${VOLUME_UNIT}`,
      `/usr/local/bin/steuerzentrale-agent zurueckspielen ${NAME}`,
      `systemctl --user start ${UNIT_APP}`,
      `systemctl --user is-active --quiet ${UNIT_APP}`,
      `systemctl --user start ${BACKUP_TIMER}`,
    ]);
    // the installation is the record's as before; nothing of a copy
    expect(a.record()[NAME]?.zustand).toBe("fertig");
    expect(Object.keys(a.record())).toEqual([NAME]);
  });

  it("plays each part back in a transient unit of the user that a time limit ends with all its processes", async () => {
    const a = await eingerichtet();
    await a.empfangen(wiederherstellen());
    expect(daten(a).teile[0]?.zurueckgespielt).toBe(true);
    const spielen = alsInstallation(a).filter((l) => imBinary(l.argv)[1] === "zurueckspielen");
    expect(spielen.map((l) => l.argv)).toEqual([
      [
        "systemd-run",
        "--user",
        "--unit",
        TRANSIENT,
        "--quiet",
        "--wait",
        "--collect",
        "--pipe",
        "--property",
        `RuntimeMaxSec=${ZEITLIMIT_S}`,
        "--property",
        "TimeoutStopSec=15",
        "--property",
        "Delegate=yes",
        "--",
        "/usr/local/bin/steuerzentrale-agent",
        "zurueckspielen",
        NAME,
      ],
    ]);
    expect(JSON.parse(spielen[0]?.eingabe ?? "{}")).toEqual({
      quelle: NAME,
      ...ZUGANG,
      snapshot: SNAPSHOT_A,
      unit: true,
      teil: {
        art: "volume",
        tag: "volume:daten",
        volume: `${NAME}-daten`,
        pfad: "/sicherung/daten",
      },
    });
  });

  it("never puts the backup's access into an argv, a result, the record or the log", async () => {
    const a = await eingerichtet();
    await a.empfangen(wiederherstellen());
    expect(daten(a).teile[0]?.zurueckgespielt).toBe(true);
    for (const wert of [PASSWORT, GEHEIM]) {
      expect(JSON.stringify(a.sys.laeufe.map((l) => [l.argv, l.umgebung]))).not.toContain(wert);
      expect(JSON.stringify([a.gesendet, a.logs, a.record()])).not.toContain(wert);
    }
  });

  it("restores a dump with only the database's container running, then starts the app", async () => {
    const a = await eingerichtet({ manifest: MIT_DB });
    await a.empfangen(mitDbWiederherstellen());
    expect(daten(a).teile).toEqual([
      { tag: "pg_dump:db:app", snapshot: SNAPSHOT_B, zurueckgespielt: true, grund: null },
    ]);
    expect(systemctl(a)).toEqual([
      `stop ${BACKUP_TIMER}`,
      "is-active --quiet sz_backup.service",
      // the app's container only: the database's keeps running for pg_restore
      `stop ${UNIT_APP}`,
      `start ${NAME}-network.service`,
      `start ${UNIT_DB}`,
      `start ${UNIT_APP} ${UNIT_DB}`,
      `is-active --quiet ${UNIT_APP} ${UNIT_DB}`,
      `start ${BACKUP_TIMER}`,
    ]);
    const ablauf = alsInstallation(a);
    const i = (f: (l: Aufgerufen) => boolean) => ablauf.findIndex(f);
    const bereit = i((l) => l.argv.includes("pg_isready"));
    const spielen = i((l) => imBinary(l.argv)[1] === "zurueckspielen");
    expect(bereit).toBeGreaterThan(-1);
    expect(bereit).toBeLessThan(spielen);
    expect(ablauf.filter((l) => l.argv.includes("volume"))).toEqual([]);
    expect(JSON.parse(ablauf[spielen]?.eingabe ?? "{}")).toMatchObject({
      snapshot: SNAPSHOT_B,
      unit: true,
      teil: {
        art: "pg_dump",
        tag: "pg_dump:db:app",
        container: `${NAME}-db`,
        datei: "/db-app.dump",
        argv: ["pg_restore", "--clean", "--if-exists", "-d", "app", "-U", "app"],
      },
    });
  });

  it("with a volume and a dump stops all units, the volume first, then the database alone", async () => {
    const manifest = ersetzen(
      MIT_DB,
      "  - { art: pg_dump, container: db, datenbank: app, nutzer: app }",
      "  - { art: volume, volume: daten }\n  - { art: pg_dump, container: db, datenbank: app, nutzer: app }",
    );
    const a = await eingerichtet({ manifest });
    await a.empfangen(
      mitDbWiederherstellen({
        manifest,
        signatur: signiert(manifest),
        argumente: { "snapshot:volume:daten": SNAPSHOT_A, "snapshot:pg_dump:db:app": SNAPSHOT_B },
      }),
    );
    expect(daten(a).teile.map((t) => [t.tag, t.snapshot])).toEqual([
      ["volume:daten", SNAPSHOT_A],
      ["pg_dump:db:app", SNAPSHOT_B],
    ]);
    const gespielt = alsInstallation(a)
      .filter((l) => imBinary(l.argv)[1] === "zurueckspielen")
      .map((l) => JSON.parse(l.eingabe ?? "{}").teil.tag);
    expect(gespielt).toEqual(["volume:daten", "pg_dump:db:app"]);
    expect(systemctl(a).slice(2, 4)).toEqual([
      `stop ${UNIT_APP} ${UNIT_DB}`,
      `restart ${VOLUME_UNIT}`,
    ]);
  });

  it("runs as the installation's user only, and never as root beyond reading its backup", async () => {
    const a = await eingerichtet();
    await a.empfangen(wiederherstellen());
    expect(daten(a).teile[0]?.zurueckgespielt).toBe(true);
    expect(a.seither().filter((l) => l.als !== NUTZER)).toEqual([]);
    expect(MANIFEST).toContain("art: volume");
  });
});

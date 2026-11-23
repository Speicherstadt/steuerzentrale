import { describe, expect, it } from "vitest";
import { NEU_GESTARTET } from "../src/auftraege/auftraege.ts";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import {
  AUFTRAEGE,
  einrichtungsAgent,
  eingerichtet as imGedaechtnis,
  MANIFEST,
  NAME,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import { type Aufgerufen, imBinary } from "../src/einrichtung/testsystem.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import { type Agent, eingerichtet, fehler } from "./pruef-restore-hilfen.ts";
import {
  alsInstallation,
  SNAPSHOT_A,
  systemctl,
  TRANSIENT,
  UNIT_APP,
  wiederherstellen,
  ZEITLIMIT_S,
} from "./wiederherstellen-hilfen.ts";

/*
 * BAULISTE.md Z-603 (docs/plan.md, "Wiederherstellen auf dem Server (Z-603)"): a restore the agent
 * refuses touches nothing of the installation; one that fails in any step, or runs out of time,
 * stops what is left of the transient unit and starts the installation's units again, and its
 * backup's timer; it is not run again after a restart of the agent.
 */

const bei = (f: (l: Aufgerufen) => boolean) => (l: Aufgerufen) => (f(l) ? 1 : undefined);

/** The units started again after a failure, each step with a time limit of its own */
const wiederGestartet = (a: Agent) => {
  const danach = [
    `stop ${TRANSIENT}`,
    `reset-failed ${UNIT_APP}`,
    `restart ${UNIT_APP}`,
    // active, and still active for ten seconds (einrichtung/neustarten.ts)
    ...Array(11).fill(`is-active --quiet ${UNIT_APP}`),
    "start sz_backup.timer",
  ];
  expect(systemctl(a).slice(-danach.length)).toEqual(danach);
};

describe("a restore is refused and touches nothing", () => {
  const nichtsAngefasst = (a: Agent) => expect(alsInstallation(a)).toEqual([]);

  it.each([
    ["an unknown tag", { argumente: { "snapshot:volume:fremd": SNAPSHOT_A } }, "unknown argument"],
    [
      "a short ID",
      { argumente: { "snapshot:volume:daten": "abc" } },
      "snapshot:volume:daten: a snapshot ID of 64 hex",
    ],
    ["no snapshot", { argumente: {} }, "no snapshot for snapshot:volume:daten"],
  ] as const)("for %s", async (_was, teil, grund) => {
    const a = await eingerichtet();
    await a.empfangen(wiederherstellen(teil as Partial<AuftragNachricht>));
    expect(fehler(a)).toContain(`abgelehnt: ${grund}`);
    nichtsAngefasst(a);
  });

  it("for a job with installation data or a backup access", async () => {
    const a = await eingerichtet();
    const einrichtung = {
      installation: {
        kundeId: "k",
        optionen: [],
        httpPort: 20001,
        ports: {},
        host: "x.example",
        ipv4: null,
      },
      einstellungen: { betreiber: {}, installation: {}, auto: {} },
    };
    await a.empfangen(wiederherstellen({ auftragId: "x1", einrichtung }));
    expect(fehler(a)).toBe("abgelehnt: a restore takes no installation data");
    const backup = {
      repository: "s3:https://s3.example.org/a/b",
      zugang: { schluesselId: "abc", geheim: "abcdefgh" },
      passwort: "x".repeat(20),
    };
    await a.empfangen(wiederherstellen({ auftragId: "x2", backup }));
    expect(fehler(a)).toContain(
      "abgelehnt: only installation_backup_einrichten carries backup data",
    );
    nichtsAngefasst(a);
  });

  it("for a manifest without backup", async () => {
    const ohne = ersetzen(
      MANIFEST,
      "backup:\n  - { art: volume, volume: daten }\n  - { art: befehl, befehl: export }\n",
      "",
    );
    const a = await eingerichtet();
    await a.empfangen(wiederherstellen({ manifest: ohne, signatur: signiert(ohne) }));
    expect(fehler(a)).toBe("abgelehnt: the manifest names no backup part");
    nichtsAngefasst(a);
  });

  it("for a manifest that is not the installation's (the labels of its units)", async () => {
    const anders = ersetzen(MANIFEST, 'version: "1.0.0"', 'version: "2.0.0"');
    const a = await eingerichtet();
    await a.empfangen(wiederherstellen({ manifest: anders, signatur: signiert(anders) }));
    expect(fehler(a)).toBe(
      "abgelehnt: die Units sind nicht aus beispiel 2.0.0, dem Manifest des Auftrags",
    );
    nichtsAngefasst(a);
  });

  it("for an installation whose backup is not set up here", async () => {
    const a = await eingerichtet({ ohneBackup: true });
    await a.empfangen(wiederherstellen());
    expect(fehler(a)).toBe(`abgelehnt: das Backup von ${NAME} ist nicht eingerichtet`);
    nichtsAngefasst(a);
  });

  it("for an installation this agent did not set up and finish", async () => {
    for (const anfang of [{}, imGedaechtnis({ [NAME]: "angelegt" })]) {
      const a = einrichtungsAgent({ anfang });
      await a.empfangen(wiederherstellen());
      expect(a.ergebnis()).toEqual({
        ok: false,
        fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
      });
      expect(a.sys.laeufe).toEqual([]);
    }
  });

  it("when a backup of the installation is running", async () => {
    const a = await eingerichtet();
    a.sys.aktiv.get(NUTZER)?.add("sz_backup.service");
    await a.empfangen(wiederherstellen());
    expect(fehler(a)).toBe(
      "Wiederherstellen gescheitert: ein Backup von beispiel-x7k2p9 läuft gerade; Units wieder gestartet",
    );
    // nothing stopped, emptied or played back
    expect(systemctl(a).filter((s) => s === `stop ${UNIT_APP}`)).toEqual([]);
    expect(alsInstallation(a).filter((l) => l.argv[0] === "podman")).toEqual([]);
  });

  // sz_backup.service is Type=oneshot (backup/units.ts): while its run goes on, systemd shows it
  // `activating`, and `systemctl is-active` exits 3 for every state but active and reloading
  // (systemctl(1), is-active; systemd.service(5), Type=oneshot)
  it("when a backup of the installation is running, as systemd shows a oneshot: activating", async () => {
    const backupAbfrage = (l: Aufgerufen) =>
      l.argv[0] === "systemctl" &&
      l.argv[2] === "is-active" &&
      l.argv.includes("sz_backup.service");
    const a = await eingerichtet({
      scheitern: (l) => (backupAbfrage(l) ? 3 : undefined),
      ausgabe: (l) => (backupAbfrage(l) ? "activating\n" : undefined),
    });
    await a.empfangen(wiederherstellen());
    expect(fehler(a)).toBe(
      "Wiederherstellen gescheitert: ein Backup von beispiel-x7k2p9 läuft gerade; Units wieder gestartet",
    );
    expect(systemctl(a).filter((s) => s === `stop ${UNIT_APP}`)).toEqual([]);
    expect(alsInstallation(a).filter((l) => l.argv[0] === "podman")).toEqual([]);
  });
});

describe("a restore that fails starts the units again", () => {
  it.each([
    [
      "stopping the units",
      bei((l) => l.argv[2] === "stop" && l.argv[3] === UNIT_APP),
      "systemctl --user stop: endete mit Code 1",
    ],
    [
      "emptying the volume",
      bei((l) => l.argv[1] === "volume" && l.argv[2] === "rm"),
      "podman volume rm: endete mit Code 1",
    ],
    [
      "playing a part back",
      bei((l) => imBinary(l.argv)[1] === "zurueckspielen"),
      "volume:daten: zurueckspielen endete mit Code 1",
    ],
    [
      "starting the units",
      bei((l) => l.argv[2] === "start" && l.argv[3] === UNIT_APP && l.argv.length === 4),
      "Start: systemctl --user start: endete mit Code 1",
    ],
  ] as const)("after %s", async (_was, scheitern, grund) => {
    const a = await eingerichtet({ scheitern });
    await a.empfangen(wiederherstellen());
    expect(fehler(a)).toBe(`Wiederherstellen gescheitert: ${grund}; Units wieder gestartet`);
    wiederGestartet(a);
  });

  it("when the health stays red, with its reason", async () => {
    const a = await eingerichtet({
      installationen: { holen: async () => new Response(null, { status: 503 }) },
    });
    await a.empfangen(wiederherstellen());
    expect(fehler(a)).toBe(
      "Wiederherstellen gescheitert: Health: HTTP 503; Units wieder gestartet",
    );
    wiederGestartet(a);
  });

  it("names what could not be started again", async () => {
    let gestoppt = false;
    const a = await eingerichtet({
      scheitern: (l) => {
        if (imBinary(l.argv)[1] === "zurueckspielen") return 1;
        if (l.argv[2] === "stop" && l.argv[3] === TRANSIENT) gestoppt = true;
        return gestoppt && l.argv[2] === "restart" ? 1 : undefined;
      },
    });
    await a.empfangen(wiederherstellen());
    expect(fehler(a)).toBe(
      "Wiederherstellen gescheitert: volume:daten: zurueckspielen endete mit Code 1; Units nicht wieder gestartet: systemctl --user restart: endete mit Code 1",
    );
    // the timer is started all the same
    expect(systemctl(a).at(-1)).toBe("start sz_backup.timer");
  });

  it("when the time limit runs out while a part is played back: the transient unit is stopped", async () => {
    const a = await eingerichtet({ haengt: (l) => imBinary(l.argv)[1] === "zurueckspielen" });
    const lauf = a.empfangen(wiederherstellen());
    for (let i = 0; i < 100 && !a.seither().some((l) => l.argv[0] === "systemd-run"); i++)
      await new Promise((r) => setTimeout(r, 1));
    const frist = a.plaene.find((p) => p.ms === ZEITLIMIT_S * 1000);
    expect(frist).toBeDefined();
    frist?.lauf();
    await lauf;
    expect(fehler(a)).toBe(
      "Wiederherstellen gescheitert: volume:daten: Zeitlimit des Auftrags überschritten; Units wieder gestartet",
    );
    wiederGestartet(a);
    // each step of starting again has a time limit of its own, not the job's that ran out
    const schritte = a.plaene.filter((p) => p.ms === 60_000);
    expect(schritte.length).toBeGreaterThanOrEqual(4);
  });
});

describe("a restore after a restart of the agent", () => {
  it("is not run again", async () => {
    const a = await eingerichtet();
    const job = wiederherstellen();
    const record = JSON.stringify({ auftraege: { [job.auftragId]: { zustand: "laeuft", am: 1 } } });
    a.fs.inhalt.set(AUFTRAEGE, { text: record, modus: 0o600 });
    const b = einrichtungsAgent({}, a.fs, a.sys);
    const vorher = a.sys.laeufe.length;
    await b.empfangen(job);
    expect(b.ergebnis()).toEqual({ ok: false, fehler: NEU_GESTARTET });
    expect(a.sys.laeufe.slice(vorher)).toEqual([]);
  });
});

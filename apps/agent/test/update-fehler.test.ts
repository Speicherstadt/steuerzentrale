import { describe, expect, it } from "vitest";
import { NEU_GESTARTET } from "../src/auftraege/auftraege.ts";
import {
  AUFTRAEGE,
  einrichtungsAgent,
  eingerichtet as imGedaechtnis,
  MANIFEST,
  NAME,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import type { Aufgerufen } from "../src/einrichtung/testsystem.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import { type Agent, eingerichtet, fehler } from "./pruef-restore-hilfen.ts";
import {
  APP_CONTAINER,
  IMAGE_NEU,
  laufendeVersion,
  NEU,
  unitDateien,
  update,
  version,
} from "./update-hilfen.ts";
import { alsInstallation, systemctl, UNIT_APP } from "./wiederherstellen-hilfen.ts";

/*
 * BAULISTE.md Z-503 (docs/plan.md, "Update auf dem Server (Z-503)"): an update the agent refuses
 * touches nothing; one that fails before the old units stop changes nothing and fails the job; one
 * that fails afterwards is not repeated after a restart of the agent. What a failure after the old
 * units stopped does (the rollback) is in update-ruecknahme.test.ts.
 */

const TIMER = "sz_backup.timer";
const bei = (f: (l: Aufgerufen) => boolean) => (l: Aufgerufen) => (f(l) ? 1 : undefined);

const nichtsAngefasst = (a: Agent) => {
  expect(alsInstallation(a)).toEqual([]);
  expect(laufendeVersion(a)).toBe("1.0.0");
};

describe("an update is refused and touches nothing", () => {
  it("for an installation this agent did not set up and finish", async () => {
    for (const anfang of [{}, imGedaechtnis({ [NAME]: "angelegt" })]) {
      const a = einrichtungsAgent({ anfang });
      await a.empfangen(update());
      expect(a.ergebnis()).toEqual({
        ok: false,
        fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
      });
      expect(a.sys.laeufe).toEqual([]);
    }
  });

  it("for the version that runs, or an older one", async () => {
    for (const [v, id] of [
      ["1.0.0", "u1"],
      ["0.9.0", "u2"],
    ] as const) {
      const a = await eingerichtet();
      const alt = version(v);
      await a.empfangen(update({ auftragId: id, manifest: alt, signatur: signiert(alt) }));
      expect(fehler(a)).toBe(
        `abgelehnt: ${NAME} hat 1.0.0; ein Update führt nur zu einer neueren Version als ${v}`,
      );
      nichtsAngefasst(a);
    }
  });

  it("for another app's manifest", async () => {
    const fremd = ersetzen(NEU, "id: beispiel", "id: anderes");
    const a = await eingerichtet();
    await a.empfangen(update({ manifest: fremd, signatur: signiert(fremd) }));
    expect(fehler(a)).toBe("abgelehnt: die Units sind aus beispiel, nicht aus anderes");
    nichtsAngefasst(a);
  });

  it("for an installation whose backup is not set up here", async () => {
    const a = await eingerichtet({ ohneBackup: true });
    await a.empfangen(update());
    expect(fehler(a)).toBe(`abgelehnt: das Backup von ${NAME} ist nicht eingerichtet`);
    nichtsAngefasst(a);
  });

  it("without the snapshot of the backup before, or with a backup access", async () => {
    const a = await eingerichtet();
    await a.empfangen(update({ argumente: {} }));
    expect(fehler(a)).toContain("abgelehnt: no snapshot for snapshot:volume:daten");
    const backup = {
      repository: "s3:https://s3.example.org/a/b",
      zugang: { schluesselId: "abc", geheim: "abcdefgh" },
      passwort: "x".repeat(20),
    };
    await a.empfangen(update({ auftragId: "u2", backup }));
    expect(fehler(a)).toContain(
      "abgelehnt: only installation_backup_einrichten carries backup data",
    );
    nichtsAngefasst(a);
  });

  it("for a manifest with a bad signature", async () => {
    const a = await eingerichtet();
    await a.empfangen(update({ signatur: signiert(MANIFEST) }));
    expect(fehler(a)).toMatch(/^abgelehnt: /);
    nichtsAngefasst(a);
  });
});

describe("an update that fails before the old units stop changes nothing", () => {
  it.each([
    ["while a backup runs", undefined, "ein Backup von beispiel-x7k2p9 läuft gerade"],
    [
      "when the old secrets cannot be read",
      bei((l) => l.argv[1] === "secret" && l.argv[2] === "ls"),
      "die alten Secrets sind nicht lesbar (podman secret ls: endete mit Code 1)",
    ],
    [
      "when the new image cannot be pulled",
      bei((l) => l.argv[1] === "pull"),
      `podman pull ${IMAGE_NEU}: endete mit Code 1`,
    ],
  ] as const)("%s", async (was, scheitern, grund) => {
    const a = await eingerichtet(scheitern ? { scheitern } : {});
    if (was === "while a backup runs") a.sys.aktiv.get(NUTZER)?.add("sz_backup.service");
    const vorher = unitDateien(a);
    await a.empfangen(update());
    expect(fehler(a)).toBe(`Update gescheitert: ${grund}; nichts geändert`);
    expect(unitDateien(a)).toEqual(vorher);
    expect(systemctl(a).filter((s) => s.startsWith(`stop ${UNIT_APP}`))).toEqual([]);
    expect(systemctl(a).at(-1)).toBe(`start ${TIMER}`);
    expect(a.sys.aktiv.get(NUTZER)?.has(UNIT_APP)).toBe(true);
    expect(a.record()[NAME]).toMatchObject({ pruefung: { units: [UNIT_APP] } });
  });

  it("refuses a unit folder with something else than files in it", async () => {
    const a = await eingerichtet();
    a.sys.dateien.set(`${APP_CONTAINER}.d`, { art: "verzeichnis", modus: 0o700, uid: 0, gid: 0 });
    await a.empfangen(update());
    expect(fehler(a)).toBe(
      `Update gescheitert: Error: ${APP_CONTAINER}.d is not a regular file; nichts geändert`,
    );
    expect(laufendeVersion(a)).toBe("1.0.0");
  });
});

describe("an update after a restart of the agent", () => {
  it("is not run again, and starts no unit of the app", async () => {
    const a = await eingerichtet();
    const job = update();
    const record = JSON.stringify({ auftraege: { [job.auftragId]: { zustand: "laeuft", am: 1 } } });
    a.fs.inhalt.set(AUFTRAEGE, { text: record, modus: 0o600 });
    const b = einrichtungsAgent({}, a.fs, a.sys);
    await b.agent.aufraeumen();
    const nachAufraeumen = a.sys.laeufe.length;
    await b.empfangen(job);
    expect(b.ergebnis()).toEqual({ ok: false, fehler: NEU_GESTARTET });
    expect(a.sys.laeufe.slice(nachAufraeumen)).toEqual([]);
  });
});

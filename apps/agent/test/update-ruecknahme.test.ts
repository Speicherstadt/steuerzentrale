import { describe, expect, it } from "vitest";
import { MANIFEST, NAME, NUTZER } from "../src/einrichtung/testauftraege.ts";
import { type Aufgerufen, imBinary } from "../src/einrichtung/testsystem.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import { type Agent, eingerichtet } from "./pruef-restore-hilfen.ts";
import {
  APP_CONTAINER,
  laufendeVersion,
  NEU,
  unitDateien,
  update,
  updateDaten,
} from "./update-hilfen.ts";
import {
  alsInstallation,
  SNAPSHOT_A,
  systemctl,
  TRANSIENT,
  UNIT_APP,
  VOLUME_UNIT,
} from "./wiederherstellen-hilfen.ts";

/*
 * BAULISTE.md Z-503 (docs/plan.md, "Update auf dem Server (Z-503)"): an update that fails once the
 * old units stopped is rolled back: the units stopped, the old files and secrets back,
 * daemon-reload; once the new version ran, its data replaced by the backup made just before, each
 * part in the transient unit with the job's snapshot, as restoring does; then the old units
 * restarted and staying active, their health checked, the backup's timer started. The result is
 * `zurueckgenommen` with the reason, or `ruecknahme_unvollstaendig` when the rollback fails too.
 */

const TIMER = "sz_backup.timer";
const CACHE = `${NAME}-cache.service`;

/** The new version's health is red, the old one's green: the broken 2.1.0 of the CI */
const kaputteNeue = (a: () => Agent | undefined) => ({
  holen: async () =>
    new Response(null, { status: a() && laufendeVersion(a() as Agent) !== "1.0.0" ? 500 : 200 }),
});

/** The installation set up with 1.0.0 and its backup, the new version's health red */
const mitRoterNeuer = async (o: Parameters<typeof eingerichtet>[0] = {}) => {
  let a: Agent | undefined;
  a = await eingerichtet({ ...o, installationen: kaputteNeue(() => a) });
  return a;
};

const mitCache = (manifest: string) =>
  ersetzen(
    manifest,
    "optionen:\n",
    [
      "  - name: cache",
      `    image: "localhost:5000/cache@sha256:${"c".repeat(64)}"`,
      "optionen:\n",
    ].join("\n"),
  );

/** The secrets of the installation's user, name and value */
const secrets = (a: Agent) => [...(a.sys.secrets.get(NUTZER) ?? new Map())];

/** The old version runs again with its files, secrets and record */
const wieVorher = (a: Agent, vorher: { dateien: unknown; secrets: unknown }) => {
  expect(laufendeVersion(a)).toBe("1.0.0");
  expect(unitDateien(a)).toEqual(vorher.dateien);
  expect(secrets(a)).toEqual(vorher.secrets);
  expect(a.record()[NAME]).toMatchObject({ zustand: "fertig", pruefung: { units: [UNIT_APP] } });
  expect(a.sys.aktiv.get(NUTZER)?.has(UNIT_APP)).toBe(true);
  expect(a.sys.aktiv.get(NUTZER)?.has(TIMER)).toBe(true);
};

const gespielt = (a: Agent) =>
  alsInstallation(a).filter((l) => imBinary(l.argv)[1] === "zurueckspielen");

describe("an update whose new version turns red is rolled back with the data from before", () => {
  it("for a red health: old units, files and secrets back, the backup played back", async () => {
    const a = await mitRoterNeuer();
    const vorher = { dateien: unitDateien(a), secrets: secrets(a) };
    await a.empfangen(update());
    expect(updateDaten(a)).toEqual({
      ergebnis: "zurueckgenommen",
      grund: "Health: HTTP 500",
      dauerMs: expect.any(Number),
    });
    wieVorher(a, vorher);
    const aktiv = Array(11).fill(`is-active --quiet ${UNIT_APP}`);
    expect(systemctl(a)).toEqual([
      `stop ${TIMER}`,
      "is-active sz_backup.service",
      `stop ${UNIT_APP}`,
      "daemon-reload",
      `reset-failed ${UNIT_APP}`,
      `restart ${UNIT_APP}`,
      ...aktiv,
      // the health turned red: back
      `stop ${UNIT_APP}`,
      "daemon-reload",
      `restart ${VOLUME_UNIT}`,
      `start ${NAME}-network.service ${VOLUME_UNIT}`,
      `reset-failed ${UNIT_APP}`,
      `restart ${UNIT_APP}`,
      ...aktiv,
      `start ${TIMER}`,
    ]);
    expect(gespielt(a).map((l) => JSON.parse(l.eingabe ?? "{}").snapshot)).toEqual([SNAPSHOT_A]);
    expect(gespielt(a)[0]?.argv.slice(0, 4)).toEqual([
      "systemd-run",
      "--user",
      "--unit",
      TRANSIENT,
    ]);
    expect(
      alsInstallation(a).some((l) => l.argv.join(" ") === `podman volume rm --force ${NAME}-daten`),
    ).toBe(true);
  });

  it.each([
    [
      "a step of schritte.nach_update fails",
      (l: Aufgerufen) => l.argv[1] === "exec" && l.argv.includes("migrieren"),
      "schritte.nach_update migrieren: endete mit Code 1",
    ],
    [
      "the new units are not active",
      (l: Aufgerufen, version?: string) =>
        version === "2.0.0" && l.argv[2] === "is-active" && l.argv[3] === "--quiet",
      `units not active: ${UNIT_APP}`,
    ],
  ] as const)("when %s", async (_was, wann, grund) => {
    let a: Agent | undefined;
    a = await eingerichtet({
      scheitern: (l) => (wann(l, a && laufendeVersion(a)) ? 1 : undefined),
    });
    const vorher = { dateien: unitDateien(a), secrets: secrets(a) };
    await a.empfangen(update());
    expect(updateDaten(a)).toMatchObject({ ergebnis: "zurueckgenommen", grund });
    wieVorher(a, vorher);
    expect(gespielt(a)).toHaveLength(1);
  });

  it("removes the unit the new version added, and brings back the one it dropped", async () => {
    const neu = mitCache(NEU);
    const a = await mitRoterNeuer();
    const vorher = { dateien: unitDateien(a), secrets: secrets(a) };
    await a.empfangen(update({ manifest: neu, signatur: signiert(neu) }));
    expect(updateDaten(a).ergebnis).toBe("zurueckgenommen");
    wieVorher(a, vorher);
    expect(systemctl(a)).toContain(`stop ${UNIT_APP} ${CACHE}`);

    const b = await mitRoterNeuer({ manifest: mitCache(MANIFEST) });
    const davor = unitDateien(b);
    await b.empfangen(update());
    expect(updateDaten(b).ergebnis).toBe("zurueckgenommen");
    expect(unitDateien(b)).toEqual(davor);
    expect(systemctl(b).at(-13)).toBe(`restart ${UNIT_APP} ${CACHE}`);
    expect(b.record()[NAME]).toMatchObject({ pruefung: { units: [UNIT_APP, CACHE] } });
  });
});

describe("an update that fails before the new version ran is rolled back without the data", () => {
  it.each([
    ["writing a new unit", "schreiben"],
    ["daemon-reload", "reload"],
  ] as const)("after %s", async (_was, wo) => {
    let an = false;
    let einmal = true;
    const einmalig = (ja: boolean) => {
      if (!ja || !an || !einmal) return false;
      einmal = false;
      return true;
    };
    const a = await eingerichtet({
      schreibenScheitert: (pfad) => wo === "schreiben" && einmalig(pfad === APP_CONTAINER),
      scheitern: (l) =>
        wo === "reload" && einmalig(l.argv[2] === "daemon-reload") ? 1 : undefined,
    });
    an = true;
    const vorher = { dateien: unitDateien(a), secrets: secrets(a) };
    await a.empfangen(update());
    const d = updateDaten(a);
    expect(d.ergebnis).toBe("zurueckgenommen");
    wieVorher(a, vorher);
    expect(gespielt(a)).toEqual([]);
    expect(alsInstallation(a).filter((l) => l.argv[1] === "volume")).toEqual([]);
    expect(
      systemctl(a).filter((s) => s.startsWith("restart") && s !== `restart ${UNIT_APP}`),
    ).toEqual([]);
  });
});

describe("an update whose rollback fails too", () => {
  it("reports ruecknahme_unvollstaendig and starts the old units all the same", async () => {
    let a: Agent | undefined;
    a = await eingerichtet({
      installationen: kaputteNeue(() => a),
      scheitern: (l) => (imBinary(l.argv)[1] === "zurueckspielen" ? 1 : undefined),
    });
    await a.empfangen(update());
    expect(updateDaten(a)).toMatchObject({
      ergebnis: "ruecknahme_unvollstaendig",
      grund:
        "Health: HTTP 500; Rücknahme: Daten: volume:daten: zurueckspielen endete mit Code 1; alte Units wieder gestartet",
    });
    expect(laufendeVersion(a)).toBe("1.0.0");
    const danach = systemctl(a).slice(-15);
    expect(danach[0]).toBe(`stop ${TRANSIENT}`);
    expect(danach[1]).toBe(`reset-failed ${UNIT_APP}`);
    expect(danach.at(-1)).toBe(`start ${TIMER}`);
    expect(a.record()[NAME]).toMatchObject({ pruefung: { units: [UNIT_APP] } });
  });
});

describe("an update whose forward part runs out of time", () => {
  it("is rolled back with the data, within the rest of the job's time", async () => {
    let an = false;
    const a = await eingerichtet({
      haengt: (l) => an && l.argv[1] === "exec" && l.argv.includes("migrieren"),
    });
    an = true;
    const lauf = a.empfangen(update());
    for (let i = 0; i < 200 && !a.seither().some((l) => l.argv[1] === "exec"); i++)
      await new Promise((r) => setTimeout(r, 1));
    // 2100 of 18300 s: setting up and the new version's health; the rest is the rollback's
    const frist = a.plaene.find((p) => p.ms === 2_100_000);
    expect(frist).toBeDefined();
    frist?.lauf();
    await lauf;
    expect(updateDaten(a)).toMatchObject({
      ergebnis: "zurueckgenommen",
      grund: "schritte.nach_update migrieren: Zeitlimit des Auftrags überschritten",
    });
    expect(gespielt(a)[0]?.argv).toContain("RuntimeMaxSec=18300");
    expect(laufendeVersion(a)).toBe("1.0.0");
  });
});

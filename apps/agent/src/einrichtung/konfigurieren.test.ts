import type { Einrichtung } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import {
  EINRICHTUNG,
  eingerichtet,
  einrichtungsAgent,
  GEHEIM,
  HOME,
  INSTALLATIONEN,
  konfigurierenAuftrag,
  NAME,
  NUTZER,
} from "./testauftraege.ts";
import { type Aufgerufen, PFORTE, type TestSystem, testSystem } from "./testsystem.ts";

/*
 * BAULISTE.md Z-404, the agent's side (docs/plan.md, "Neu konfigurieren"): `installation_konfigurieren`
 * only for an installation this agent set up and finished, with the same units; it keeps the old
 * units, slice, files and secrets, writes the new ones, replaces the secrets, reloads and restarts
 * the units and waits until they are active; a failing step brings the old state back and restarts
 * it. No volume, no setup step, no pull; the record changes only on success; no secret value in an
 * argv, a result or a record. On a server in memory (testsystem.ts).
 */

const UNITS = [`${NAME}-app.service`];
const UNIT = `${HOME}/.config/containers/systemd/${NAME}-app.container`;
const SLICE = `${HOME}/.config/systemd/user/${NAME}.slice`;
const SECRET = `${NAME}-beispiel-schluessel`;
const NEU_GEHEIM = "ganz-neu-geheim-4711";

/** The settings after the change: a new title and a new secret value */
const NEU: Einrichtung = {
  ...EINRICHTUNG,
  einstellungen: {
    betreiber: {},
    installation: { BEISPIEL_TITEL: "Neuer Titel" },
    auto: { BEISPIEL_SCHLUESSEL: NEU_GEHEIM },
  },
};

const MIT_WORKER: Einrichtung = {
  ...NEU,
  installation: { ...NEU.installation, optionen: ["worker"] },
};

/** A server with the installation set up by a job, and the agent that did it */
const eingerichteterAgent = async (
  scheitern?: (l: Aufgerufen, sys: TestSystem) => number | undefined,
  ausgabe?: (l: Aufgerufen) => string | undefined,
) => {
  let nachher = false;
  const sys: TestSystem = testSystem({
    nutzer: [PFORTE],
    scheitern: (l) => (nachher ? scheitern?.(l, sys) : undefined),
    ausgabe: (l) => (nachher ? ausgabe?.(l) : undefined),
  });
  const a = einrichtungsAgent({}, undefined, sys);
  await a.empfangen();
  expect(a.ergebnis()).toMatchObject({ ok: true });
  nachher = true;
  const vorher = {
    laeufe: a.sys.laeufe.length,
    unit: a.sys.dateien.get(UNIT)?.inhalt,
    slice: a.sys.dateien.get(SLICE)?.inhalt,
    record: a.record(),
    geschrieben: a.fs.reihenfolge.filter((p) => p === INSTALLATIONEN).length,
  };
  const seither = () => a.sys.laeufe.slice(vorher.laeufe);
  const programmeSeither = () => a.programme().slice(vorher.laeufe);
  const recordGeschrieben = () =>
    a.fs.reihenfolge.filter((p) => p === INSTALLATIONEN).length - vorher.geschrieben;
  return { ...a, vorher, seither, programmeSeither, recordGeschrieben };
};

/** Nothing on the server changed: no run, the same files and secrets, the record as it was */
const unveraendert = (a: Awaited<ReturnType<typeof eingerichteterAgent>>) => {
  expect(a.seither().filter((l) => !l.gelesen)).toEqual([]);
  expect(a.sys.dateien.get(UNIT)?.inhalt).toBe(a.vorher.unit);
  expect(a.sys.secrets.get(NUTZER)?.get(SECRET)).toBe(GEHEIM);
  expect(a.recordGeschrieben()).toBe(0);
};

/** The old state back: the old unit and secret, the units restarted and active */
const alterStand = (a: Awaited<ReturnType<typeof eingerichteterAgent>>) => {
  expect(a.sys.dateien.get(UNIT)?.inhalt).toBe(a.vorher.unit);
  expect(a.sys.dateien.get(SLICE)?.inhalt).toBe(a.vorher.slice);
  expect(a.sys.secrets.get(NUTZER)).toEqual(new Map([[SECRET, GEHEIM]]));
  expect(a.sys.aktiv.get(NUTZER)).toEqual(new Set(UNITS));
  expect(a.recordGeschrieben()).toBe(0);
  expect(a.record()).toEqual(a.vorher.record);
};

describe("reconfiguring an installation", () => {
  it("writes the new units and secrets, restarts the units and reports it", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: true,
      daten: { installation: NAME, geaendert: "konfiguriert", units: UNITS },
    });
    expect(a.sys.dateien.get(UNIT)?.inhalt).toContain("BEISPIEL_TITEL=Neuer Titel");
    expect(a.sys.secrets.get(NUTZER)).toEqual(new Map([[SECRET, NEU_GEHEIM]]));
    expect(a.sys.aktiv.get(NUTZER)).toEqual(new Set(UNITS));
    expect(new Set(a.programmeSeither())).toEqual(
      new Set([
        `${NUTZER}: podman secret`,
        `${NUTZER}: systemctl --user daemon-reload`,
        `${NUTZER}: systemctl --user reset-failed`,
        `${NUTZER}: systemctl --user restart`,
        `${NUTZER}: systemctl --user is-active`,
      ]),
    );
    expect(a.seither().map((l) => l.argv.slice(0, 3).join(" "))).toEqual(
      expect.arrayContaining([
        "podman secret ls",
        "podman secret inspect",
        "podman secret rm",
        "podman secret create",
      ]),
    );
    // the restart names the installation's units, and only them
    expect(a.seither().find((l) => l.argv[2] === "restart")?.argv).toEqual([
      "systemctl",
      "--user",
      "restart",
      ...UNITS,
    ]);
    expect(a.recordGeschrieben()).toBe(1);
    expect(a.record()[NAME]).toMatchObject({ zustand: "fertig", pruefung: { units: UNITS } });
  });

  it("runs no setup step, pulls no image, makes no user and touches no volume", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(konfigurierenAuftrag(NEU));
    const argv = a.seither().map((l) => l.argv.join(" "));
    for (const verboten of ["podman exec", "podman pull", "useradd", "userdel", "volume", "stop"])
      expect(argv.filter((z) => z.includes(verboten))).toEqual([]);
    expect(a.seither().every((l) => l.als === NUTZER)).toBe(true);
  });

  it("writes the files owned by the user, as setting up does", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(konfigurierenAuftrag(NEU));
    const n = a.sys.nutzer.get(NUTZER);
    expect(a.sys.dateien.get(UNIT)).toMatchObject({ modus: 0o600, uid: n?.uid, gid: n?.gid });
  });

  it("puts a new secret value only on a pipe, never in an argv, a result or a record", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(konfigurierenAuftrag(NEU));
    const angelegt = a.seither().find((l) => l.argv[2] === "create");
    expect(angelegt?.argv).toEqual(["podman", "secret", "create", SECRET, "-"]);
    expect(angelegt?.eingabe).toBe(NEU_GEHEIM);
    for (const wert of [GEHEIM, NEU_GEHEIM]) {
      expect(JSON.stringify(a.sys.laeufe.map((l) => [l.argv, l.umgebung]))).not.toContain(wert);
      expect(JSON.stringify(a.gesendet)).not.toContain(wert);
      expect([...a.fs.inhalt.values()].map((d) => d.text).join("\n")).not.toContain(wert);
    }
  });

  it("is reported failed after a restart of the agent, not run again", async () => {
    const a = await eingerichteterAgent();
    a.fs.inhalt.set("/z/auftraege.json", {
      text: JSON.stringify({ auftraege: { k1: { zustand: "laeuft", am: 0 } } }),
      modus: 0o600,
    });
    const neu = einrichtungsAgent({}, a.fs, a.sys);
    await neu.empfangen(konfigurierenAuftrag(NEU));
    expect(neu.ergebnis()).toEqual({ ok: false, fehler: "Agent neu gestartet" });
    unveraendert(a);
  });
});

describe("reconfiguring is refused, and changes nothing", () => {
  it("for an installation this agent did not set up", async () => {
    const fremd = { name: NUTZER, uid: 3000, gid: 3000, home: HOME };
    const a = einrichtungsAgent({ nutzer: [PFORTE, fremd] });
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
    });
    expect(a.sys.laeufe).toEqual([]);
    expect(a.record()).toEqual({});
  });

  it("for an installation whose setup did not finish", async () => {
    const a = einrichtungsAgent({ anfang: eingerichtet({ [NAME]: "angelegt" }) });
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
    });
    expect(a.sys.laeufe).toEqual([]);
  });

  it("for a finished installation whose units the record does not know (before Z-403)", async () => {
    const a = einrichtungsAgent({ anfang: eingerichtet({ [NAME]: "fertig" }) });
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toMatchObject({
      ok: false,
      fehler: expect.stringContaining("abgelehnt:"),
    });
    expect(a.sys.laeufe).toEqual([]);
  });

  it("when the options change the units", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(konfigurierenAuftrag(MIT_WORKER));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: die Units von ${NAME} wären ${NAME}-app.service, ${NAME}-worker.service statt ${NAME}-app.service; neu konfigurieren ändert keine Optionen`,
    });
    unveraendert(a);
    expect(a.seither()).toEqual([]);
  });

  it("when a file of the installation is missing, so the files would change", async () => {
    const a = await eingerichteterAgent();
    a.sys.dateien.delete(SLICE);
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${SLICE} fehlt; neu konfigurieren ändert nicht, welche Dateien die Installation hat`,
    });
    expect(a.sys.dateien.has(SLICE)).toBe(false);
    unveraendert(a);
  });

  it("when the old secrets cannot be read, before anything is changed", async () => {
    const a = await eingerichteterAgent((l) => (l.argv[2] === "inspect" ? 125 : undefined));
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler:
        "Neu konfigurieren gescheitert: die alten Secrets sind nicht lesbar (podman secret inspect: endete mit Code 125); nichts geändert",
    });
    unveraendert(a);
  });

  it("when Podman names a secret the agent never makes, never passing it on as an option", async () => {
    const a = await eingerichteterAgent(undefined, (l) =>
      l.argv[2] === "ls" ? "--all\n" : undefined,
    );
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler:
        "Neu konfigurieren gescheitert: die alten Secrets sind nicht lesbar (podman secret ls: ein Name, den der Agent nicht vergibt); nichts geändert",
    });
    expect(a.seither().map((l) => l.argv[2])).toEqual(["ls"]);
    unveraendert(a);
  });

  it("when Podman answers with something else than its report, naming nothing of it", async () => {
    const a = await eingerichteterAgent(undefined, (l) =>
      l.argv[2] === "inspect" ? `kein json ${GEHEIM}` : undefined,
    );
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler:
        "Neu konfigurieren gescheitert: die alten Secrets sind nicht lesbar (podman secret inspect: keine lesbare Antwort); nichts geändert",
    });
    unveraendert(a);
  });
});

/** A step of reconfiguring, and how to make it fail */
const FEHLSCHRITTE: [string, (l: Aufgerufen, sys: TestSystem) => boolean][] = [
  [`podman secret rm ${SECRET}`, (l) => l.argv[2] === "rm" && !l.argv.includes("--ignore")],
  [`podman secret create ${SECRET}`, (l) => l.argv[2] === "create" && l.eingabe === NEU_GEHEIM],
  [
    "systemctl --user daemon-reload",
    (l, sys) =>
      l.argv[2] === "daemon-reload" &&
      (sys.dateien.get(UNIT)?.inhalt ?? "").includes("Neuer Titel"),
  ],
  [
    "systemctl --user restart",
    (l, sys) =>
      l.argv[2] === "restart" && (sys.dateien.get(UNIT)?.inhalt ?? "").includes("Neuer Titel"),
  ],
];

describe("a failing step of reconfiguring", () => {
  it.each(FEHLSCHRITTE)(
    "%s: the old state is back and restarted before the result",
    async (schritt, trifft) => {
      const a = await eingerichteterAgent((l, sys) => (trifft(l, sys) ? 7 : undefined));
      await a.empfangen(konfigurierenAuftrag(NEU));
      expect(a.ergebnis()).toEqual({
        ok: false,
        fehler: `Neu konfigurieren gescheitert: ${schritt}: endete mit Code 7; alter Stand wiederhergestellt`,
      });
      alterStand(a);
    },
  );

  it("units that do not become active with the new state: the old one is back", async () => {
    const a = await eingerichteterAgent((l, sys) =>
      l.argv[2] === "is-active" && (sys.dateien.get(UNIT)?.inhalt ?? "").includes("Neuer Titel")
        ? 3
        : undefined,
    );
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `Neu konfigurieren gescheitert: units not active: ${UNITS.join(", ")}; alter Stand wiederhergestellt`,
    });
    alterStand(a);
  });

  it("units that are active at first and then fail: the old state is back", async () => {
    let gefragt = 0;
    const a = await eingerichteterAgent((l, sys) => {
      if (l.argv[2] !== "is-active") return undefined;
      if (!(sys.dateien.get(UNIT)?.inhalt ?? "").includes("Neuer Titel")) return undefined;
      // active once after the restart, then crashed (Restart=always, then systemd's start limit)
      gefragt++;
      return gefragt === 1 ? undefined : 3;
    });
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `Neu konfigurieren gescheitert: units did not stay active: ${UNITS.join(", ")}; alter Stand wiederhergestellt`,
    });
    alterStand(a);
    // systemd's start limit would refuse the restart of the old state without a reset first
    const schritte = a.seither().map((l) => l.argv[2]);
    expect(
      schritte.slice(schritte.lastIndexOf("restart") - 1, schritte.lastIndexOf("restart")),
    ).toEqual(["reset-failed"]);
  });

  it("writing a file throws: the old files are back", async () => {
    let einmal = false;
    const sys: TestSystem = testSystem({
      nutzer: [PFORTE],
      schreibenScheitert: (pfad) => {
        if (!einmal || pfad !== SLICE) return false;
        einmal = false;
        return true;
      },
    });
    const a = einrichtungsAgent({}, undefined, sys);
    await a.empfangen();
    const unit = sys.dateien.get(UNIT)?.inhalt;
    einmal = true;
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `Neu konfigurieren gescheitert: Error: EIO: ${SLICE}; alter Stand wiederhergestellt`,
    });
    expect(sys.dateien.get(UNIT)?.inhalt).toBe(unit);
    expect(sys.secrets.get(NUTZER)).toEqual(new Map([[SECRET, GEHEIM]]));
  });

  it("says so when the old state cannot be brought back either", async () => {
    const a = await eingerichteterAgent((l) => (l.argv[2] === "restart" ? 7 : undefined));
    await a.empfangen(konfigurierenAuftrag(NEU));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler:
        "Neu konfigurieren gescheitert: systemctl --user restart: endete mit Code 7; Wiederherstellung unvollständig: systemctl --user restart: endete mit Code 7",
    });
    // the old files and secrets are back all the same
    expect(a.sys.dateien.get(UNIT)?.inhalt).toBe(a.vorher.unit);
    expect(a.sys.secrets.get(NUTZER)).toEqual(new Map([[SECRET, GEHEIM]]));
    expect(a.recordGeschrieben()).toBe(0);
  });

  it("never names a secret value in the result of a failure", async () => {
    const a = await eingerichteterAgent((l) => (l.argv[2] === "restart" ? 7 : undefined));
    await a.empfangen(konfigurierenAuftrag(NEU));
    for (const wert of [GEHEIM, NEU_GEHEIM]) {
      expect(JSON.stringify(a.gesendet)).not.toContain(wert);
      expect(JSON.stringify(a.sys.laeufe.map((l) => l.argv))).not.toContain(wert);
    }
  });
});

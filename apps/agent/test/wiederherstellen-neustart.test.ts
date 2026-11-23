import { BACKUP_AKTIONEN } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import {
  EINRICHTUNG,
  einrichtenAuftrag,
  einrichtungsAgent,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import type { Aufgerufen } from "../src/einrichtung/testsystem.ts";
import { type Agent, eingerichtet, ZUGANG } from "./pruef-restore-hilfen.ts";
import { TRANSIENT, UNIT_APP } from "./wiederherstellen-hilfen.ts";

/*
 * BAULISTE.md Z-603 (docs/plan.md, "Neustart des Agenten beim Wiederherstellen (Z-603)"): when the
 * agent starts again, a restore it was running is not run again, but what it left is set right for
 * each installation it set up and finished whose backup is set up here: a transient unit still
 * playing back is stopped, the backup's timer is started. The app's units stay as they are: the
 * health shows them stopped, and the action "Neustart" starts them. A failure for one installation
 * is logged and holds back neither the agent nor the next installation.
 */

const TIMER = "sz_backup.timer";
const ZWEITE = "zweite-a1b2c3";
const ZWEITE_NUTZER = `sz-${ZWEITE}`;

/** The agent as it starts again on the same server, what ran since, as user and argv */
const neuGestartet = async (a: Agent) => {
  const vorher = a.sys.laeufe.length;
  const neu = einrichtungsAgent({}, a.fs, a.sys);
  await neu.agent.aufraeumen();
  const seither = a.sys.laeufe
    .slice(vorher)
    .filter((l) => l.argv[0] === "systemctl")
    .map((l) => `${l.als}: ${l.argv.slice(2).join(" ")}`);
  return { neu, seither };
};

/** The restore as a restart left it in the middle: the transient unit runs, the app and timer not */
const mittendrin = (a: Agent, nutzer = NUTZER) => {
  const aktiv = a.sys.aktiv.get(nutzer) ?? new Set<string>();
  a.sys.aktiv.set(nutzer, aktiv);
  aktiv.delete(TIMER);
  aktiv.delete(UNIT_APP);
  aktiv.add(TRANSIENT);
};

describe("a restore the agent was running when it stopped", () => {
  it("stops the transient unit and starts the backup's timer, but not the app's units", async () => {
    const a = await eingerichtet();
    mittendrin(a);
    const { seither } = await neuGestartet(a);
    expect(seither).toEqual([`${NUTZER}: stop ${TRANSIENT}`, `${NUTZER}: start ${TIMER}`]);
    const aktiv = a.sys.aktiv.get(NUTZER);
    expect(aktiv?.has(TRANSIENT)).toBe(false);
    expect(aktiv?.has(TIMER)).toBe(true);
    expect(aktiv?.has(UNIT_APP)).toBe(false);
  });

  // `systemctl stop` of a unit that is not loaded fails (`--collect` unloaded it at its end): the
  // unit's state then answers whether it still runs (systemctl(1), is-active)
  it("counts a transient unit that is not loaded as stopped", async () => {
    const nichtGeladen = (l: Aufgerufen) =>
      l.argv[2] === "stop" && l.argv[3] === TRANSIENT ? 5 : undefined;
    const a = await eingerichtet({ scheitern: nichtGeladen });
    mittendrin(a);
    a.sys.aktiv.get(NUTZER)?.delete(TRANSIENT);
    const { neu, seither } = await neuGestartet(a);
    expect(seither).toEqual([
      `${NUTZER}: stop ${TRANSIENT}`,
      `${NUTZER}: is-active ${TRANSIENT}`,
      `${NUTZER}: start ${TIMER}`,
    ]);
    expect(neu.logs.some((l) => l.includes("not cleaned up"))).toBe(false);
  });

  it("leaves an installation alone whose backup is not set up here", async () => {
    const a = await eingerichtet({ ohneBackup: true });
    const { seither } = await neuGestartet(a);
    expect(seither).toEqual([]);
  });

  it("logs a failure for one installation and goes on with the next, without ending", async () => {
    // the first installation's transient unit cannot be stopped and still runs
    const ersteStopp = (l: Aufgerufen) =>
      l.als === NUTZER && l.argv[2] === "stop" && l.argv[3] === TRANSIENT ? 1 : undefined;
    const a = await eingerichtet({ scheitern: ersteStopp });
    const zweite = { ...EINRICHTUNG.installation, httpPort: 20021, ports: { "app:9000": 20022 } };
    await a.empfangen(
      einrichtenAuftrag({
        auftragId: "e2",
        installationId: ZWEITE,
        einrichtung: { ...EINRICHTUNG, installation: zweite },
      }),
    );
    expect(a.ergebnis()).toMatchObject({ ok: true });
    await a.empfangen(
      einrichtenAuftrag({
        auftragId: "b2",
        installationId: ZWEITE,
        aktion: BACKUP_AKTIONEN.einrichten,
        einrichtung: undefined,
        backup: { ...ZUGANG, repository: `${ZUGANG.repository}-2` },
      }),
    );
    expect(a.ergebnis()).toMatchObject({ ok: true });
    mittendrin(a);
    mittendrin(a, ZWEITE_NUTZER);
    const { neu, seither } = await neuGestartet(a);
    expect(seither).toContain(`${NUTZER}: start ${TIMER}`);
    expect(seither).toContain(`${ZWEITE_NUTZER}: stop ${TRANSIENT}`);
    expect(seither).toContain(`${ZWEITE_NUTZER}: start ${TIMER}`);
    expect(a.sys.aktiv.get(ZWEITE_NUTZER)?.has(TRANSIENT)).toBe(false);
    expect(neu.logs.filter((l) => l.includes("not cleaned up"))).toEqual([
      expect.stringContaining(`"installation":"beispiel-x7k2p9"`),
    ]);
  });

  it("does not end the starting agent when its record cannot be read, and is logged", async () => {
    const a = await eingerichtet();
    a.fs.inhalt.set("/z/installationen.json", { text: "{kaputt", modus: 0o600 });
    const neu = einrichtungsAgent({}, a.fs, a.sys);
    await expect(neu.agent.aufraeumen()).resolves.toBeUndefined();
    expect(neu.logs.some((l) => l.includes("restore leftovers not cleaned up"))).toBe(true);
  });
});

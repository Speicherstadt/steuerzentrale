import { describe, expect, it } from "vitest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import { einrichtungsAgent, MANIFEST, NAME } from "../src/einrichtung/testauftraege.ts";
import { PFORTE } from "../src/einrichtung/testsystem.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import {
  type Agent,
  daten,
  eingerichtet,
  KOPIE,
  KOPIE_HOME,
  KOPIE_NUTZER,
  pruefRestore,
} from "./pruef-restore-hilfen.ts";

/*
 * BAULISTE.md Z-602 (docs/plan.md, "Prüf-Restore auf dem Server"): a Prüf-Restore the agent refuses
 * makes nothing, and a copy that a stop of the agent left behind is torn down when it starts again
 * and before the job runs again after the restart.
 */

describe("a Prüf-Restore is refused and makes nothing", () => {
  const nichtsGemacht = (a: Agent) => {
    expect(a.seither().filter((l) => l.argv.includes(KOPIE_NUTZER))).toEqual([]);
    expect(a.seither().filter((l) => l.als === KOPIE_NUTZER)).toEqual([]);
    expect(Object.keys(a.record())).toEqual([NAME]);
  };

  it.each([
    ["a copy named otherwise", { argumente: { kopie: "beispiel-a1b2c3" } }, "argumente.kopie"],
    ["the original as copy", { argumente: { kopie: NAME } }, "argumente.kopie"],
    ["no data of the copy", { einrichtung: undefined }, "einrichtung"],
  ] as const)("for %s", async (_was, teil, grund) => {
    const a = await eingerichtet();
    await a.empfangen(pruefRestore(teil as Partial<AuftragNachricht>));
    expect(a.ergebnis()).toMatchObject({ ok: false });
    expect((a.ergebnis() as { fehler: string }).fehler).toContain(grund);
    nichtsGemacht(a);
  });

  it("for a manifest without backup", async () => {
    const ohne = ersetzen(
      MANIFEST,
      "backup:\n  - { art: volume, volume: daten }\n  - { art: befehl, befehl: export }\n",
      "",
    );
    const a = await eingerichtet();
    await a.empfangen(pruefRestore({ manifest: ohne, signatur: signiert(ohne) }));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: the manifest names no backup part",
    });
    nichtsGemacht(a);
  });

  it("for a manifest that is not the original's (the labels of its units)", async () => {
    const anders = ersetzen(MANIFEST, 'version: "1.0.0"', 'version: "2.0.0"');
    const a = await eingerichtet();
    await a.empfangen(pruefRestore({ manifest: anders, signatur: signiert(anders) }));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: die Units sind nicht aus beispiel 2.0.0, dem Manifest des Auftrags",
    });
    nichtsGemacht(a);
  });

  it("for an installation whose backup is not set up here", async () => {
    const a = await eingerichtet({ ohneBackup: true });
    await a.empfangen(pruefRestore());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: das Backup von ${NAME} ist nicht eingerichtet`,
    });
    nichtsGemacht(a);
  });

  it("for an installation this agent did not set up", async () => {
    const a = einrichtungsAgent();
    await a.empfangen(pruefRestore());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
    });
    expect(a.sys.laeufe).toEqual([]);
  });

  it("for a copy's user that someone else made", async () => {
    const fremd = { name: KOPIE_NUTZER, uid: 3000, gid: 3000, home: KOPIE_HOME };
    const a = await eingerichtet({ nutzer: [PFORTE, fremd] });
    await a.empfangen(pruefRestore());
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `abgelehnt: ${KOPIE_NUTZER} gibt es schon, nicht von diesem Agenten angelegt`,
    });
    expect(a.sys.nutzer.get(KOPIE_NUTZER)).toEqual(fremd);
    expect(a.seither().filter((l) => l.argv.includes(KOPIE_NUTZER))).toEqual([]);
  });
});

describe("a copy left by a stop of the agent", () => {
  /** The copy as a stop of the agent leaves it: its user made, the record says `angelegt` */
  const liegenGeblieben = async () => {
    const a = await eingerichtet();
    await a.sys.spawn(
      ["useradd", "--create-home", "--home-dir", KOPIE_HOME, KOPIE_NUTZER],
      new AbortController().signal,
    );
    const record = JSON.parse(a.fs.inhalt.get("/z/installationen.json")?.text ?? "{}");
    record.installationen[KOPIE] = { zustand: "angelegt", am: 0 };
    a.fs.inhalt.set("/z/installationen.json", { text: JSON.stringify(record), modus: 0o600 });
    return a;
  };

  it("is torn down when the agent starts again", async () => {
    const a = await liegenGeblieben();
    const neu = einrichtungsAgent({}, a.fs, a.sys);
    await neu.agent.aufraeumen();
    expect(a.sys.nutzer.has(KOPIE_NUTZER)).toBe(false);
    expect(a.sys.dateien.has(KOPIE_HOME)).toBe(false);
    expect(Object.keys(neu.record())).toEqual([NAME]);
    expect(neu.logs).toContain(
      JSON.stringify({ msg: "pruef-restore leftovers torn down", kopien: [KOPIE] }),
    );
  });

  it("is torn down before the job runs again after the restart, which then succeeds", async () => {
    const a = await liegenGeblieben();
    a.fs.inhalt.set("/z/auftraege.json", {
      text: JSON.stringify({ auftraege: { p1: { zustand: "laeuft", am: 0 } } }),
      modus: 0o600,
    });
    const neu = einrichtungsAgent({}, a.fs, a.sys);
    await neu.empfangen(pruefRestore());
    expect(daten({ ...a, ergebnis: neu.ergebnis })).toMatchObject({
      gelungen: true,
      abgebaut: true,
    });
    const nutzerLaeufe = a.seither().filter((l) => l.argv.at(-1) === KOPIE_NUTZER);
    // the test's own useradd, the teardown of what was left, the new copy and its teardown
    expect(nutzerLaeufe.map((l) => l.argv[0])).toEqual([
      "useradd",
      "loginctl",
      "loginctl",
      "userdel",
      "useradd",
      "loginctl",
      "loginctl",
      "loginctl",
      "userdel",
    ]);
    expect(Object.keys(neu.record())).toEqual([NAME]);
  });
});

import { describe, expect, it } from "vitest";
import { NEU_GESTARTET } from "../src/auftraege/auftraege.ts";
import {
  AUFTRAEGE,
  eingerichtet,
  einrichtungsAgent,
  NAME,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import type { Aufgerufen } from "../src/einrichtung/testsystem.ts";
import {
  AUTO,
  aktionsAuftrag,
  aktionsEinrichtung,
  aktionsManifest,
  PASSWORT,
} from "./aktionen-hilfen.ts";

/*
 * BAULISTE.md Z-405, the agent's side of the restart (docs/plan.md, "Neustart", "Aktiv nach dem
 * Neustart"): only when the manifest offers it and only for an installation this agent set up and
 * finished; `reset-failed`, then `restart` of its units as its user, waiting until they are active
 * and stay active; not run again after a restart of the agent. On a server in memory.
 */

const UNITS = [`${NAME}-app.service`];

const eingerichteterAgent = async (scheitern?: (l: Aufgerufen) => number | undefined) => {
  let nachher = false;
  const a = einrichtungsAgent({ scheitern: (l) => (nachher ? scheitern?.(l) : undefined) });
  await a.empfangen(aktionsEinrichtung());
  expect(a.ergebnis()).toMatchObject({ ok: true });
  nachher = true;
  const vorher = a.sys.laeufe.length;
  return {
    ...a,
    seither: () => a.programme().slice(vorher),
    laeufe: () => a.sys.laeufe.slice(vorher),
  };
};

describe("a restart of an installation", () => {
  it("resets, restarts and waits until the units are active and stay so, as its user", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(aktionsAuftrag("neustart"));
    expect(a.ergebnis()).toEqual({ ok: true, daten: { installation: NAME, units: UNITS } });
    expect(a.seither()).toEqual([
      `${NUTZER}: systemctl --user reset-failed`,
      `${NUTZER}: systemctl --user restart`,
      ...Array(11).fill(`${NUTZER}: systemctl --user is-active`),
    ]);
    expect(a.laeufe()[1]?.argv).toEqual(["systemctl", "--user", "restart", ...UNITS]);
    // nothing but systemctl ran (above), and no value reached a message or the agent's log
    const geschrieben = JSON.stringify([a.gesendet, a.logs]);
    for (const wert of [PASSWORT, AUTO]) expect(geschrieben).not.toContain(wert);
  });

  it("fails when the units do not stay active", async () => {
    let gefragt = 0;
    const a = await eingerichteterAgent((l) =>
      l.argv[2] === "is-active" && ++gefragt > 3 ? 3 : undefined,
    );
    await a.empfangen(aktionsAuftrag("neustart"));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: `Neustart gescheitert: units did not stay active: ${UNITS.join(", ")}`,
    });
  });

  it("does not count the code of reset-failed", async () => {
    const a = await eingerichteterAgent((l) => (l.argv[2] === "reset-failed" ? 1 : undefined));
    await a.empfangen(aktionsAuftrag("neustart"));
    expect(a.ergebnis()).toMatchObject({ ok: true });
  });

  it("is refused when the manifest does not offer it, before anything runs", async () => {
    const a = await eingerichteterAgent();
    const ohne = aktionsManifest(
      "{ nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt, neustart: nicht_unterstuetzt }",
    );
    await a.empfangen(aktionsAuftrag("neustart", {}, ohne));
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: the manifest does not offer neustart",
    });
    expect(a.seither()).toEqual([]);
  });

  it("is refused with arguments or installation data", async () => {
    const a = await eingerichteterAgent();
    await a.empfangen(aktionsAuftrag("neustart", { argumente: { units: "alle" } }));
    expect(a.ergebnis()).toEqual({ ok: false, fehler: "abgelehnt: unknown argument units" });
    await a.empfangen(
      aktionsAuftrag("neustart", {
        auftragId: "n2",
        einrichtung: aktionsEinrichtung().einrichtung,
      }),
    );
    expect(a.ergebnis()).toEqual({
      ok: false,
      fehler: "abgelehnt: only a setup job carries installation data (einrichtung)",
    });
    expect(a.seither()).toEqual([]);
  });

  it("is refused for an installation this agent did not set up and finish", async () => {
    for (const anfang of [{}, eingerichtet({ [NAME]: "angelegt" })]) {
      const a = einrichtungsAgent({ anfang });
      await a.empfangen(aktionsAuftrag("neustart"));
      expect(a.ergebnis()).toEqual({
        ok: false,
        fehler: `abgelehnt: ${NAME} ist keine fertig eingerichtete Installation dieses Agenten`,
      });
      expect(a.sys.laeufe).toEqual([]);
    }
  });

  it("is not run again after a restart of the agent", async () => {
    const a = await eingerichteterAgent();
    const job = aktionsAuftrag("neustart");
    const record = JSON.stringify({
      auftraege: { [job.auftragId]: { zustand: "laeuft", am: 1 } },
    });
    a.fs.inhalt.set(AUFTRAEGE, { text: record, modus: 0o600 });
    const b = einrichtungsAgent({}, a.fs, a.sys);
    const vorher = a.sys.laeufe.length;
    await b.empfangen(job);
    expect(b.ergebnis()).toEqual({ ok: false, fehler: NEU_GESTARTET });
    expect(a.sys.laeufe.slice(vorher)).toEqual([]);
  });
});

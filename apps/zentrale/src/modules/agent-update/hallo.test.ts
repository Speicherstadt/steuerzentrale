import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_UPDATE_AKTION } from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { ereignisse } from "../../db/schema.ts";
import { serverHinzufuegen } from "../../testhilfen/agent.ts";
import { testServer } from "../../testhilfen/server.ts";
import { agentBeitreten, fingerabdruckVon } from "../../testhilfen/tls.ts";
import { auftragAnlegen, auftragMelden } from "../auftraege/index.ts";
import { serverZumFingerabdruck } from "../server/index.ts";
import { sitzung } from "../verbindung/sitzung.ts";
import type { Sockel } from "../verbindung/verbindungen.ts";
import { AGENT_ARTEN } from "./ende.ts";

/** A version newer than this build's, whatever package.json says */
const NEUER = "99.0.1";

/*
 * BAULISTE.md Z-504: whether an update of the agent holds shows its next `hallo`. A newer version
 * than before is an event `agent_aktualisiert`, an older one `agent_zurueckgekehrt` (the old agent
 * came back); the same version again none. A new agent that never said hallo leaves the version as
 * it was: the old one's hallo after a successful job is the return, once.
 */
const FIXTURES = join(import.meta.dirname, "../../../../../packages/manifest/test");

const aufgebaut = async () => {
  const server = testServer();
  const inhaber = await server.inhaber();
  const { token } = await serverHinzufuegen(inhaber);
  const agent = await agentBeitreten(server, token);
  const fingerabdruck = await fingerabdruckVon(agent.zertifikat);
  const melden = async (agentVersion: string) => {
    const gefunden = serverZumFingerabdruck(server.db, fingerabdruck);
    if (!gefunden) throw new Error("not found");
    const gesendet: Record<string, unknown>[] = [];
    const sockel: Sockel = { senden: (t) => gesendet.push(JSON.parse(t)), schliessen: () => {} };
    const s = sitzung(server.deps, gefunden);
    s.offen(sockel);
    await s.nachricht(
      JSON.stringify({
        typ: "hallo",
        protokoll: PROTOKOLL_VERSION,
        agentVersion,
        architektur: "amd64",
        zeit: 1,
      }),
    );
    s.zu();
    return gesendet;
  };
  const arten = () =>
    server.db
      .select()
      .from(ereignisse)
      .all()
      .filter((e) => e.art.startsWith("agent_"))
      .map((e) => [e.art, e.schwere, e.text]);
  const zeile = () => {
    const gefunden = serverZumFingerabdruck(server.db, fingerabdruck);
    if (!gefunden) throw new Error("not found");
    return gefunden.server;
  };
  /** A job `agent_update` to `version` that the agent reported as done (the new binary in place) */
  const aktualisiert = (version: string) => {
    const { betreiberId, serverId } = zeile();
    const jetzt = server.jetzt();
    // the old agent connected while the job is made, so it is sent
    const alter: Sockel = { senden: () => {}, schliessen: () => {} };
    server.deps.verbindungen.anmelden(betreiberId, serverId, alter, jetzt);
    server.deps.verbindungen.gruessen(betreiberId, serverId, alter);
    const r = auftragAnlegen(
      server.deps,
      { betreiberId, akteur: "system", jetzt, grund: "Test" },
      {
        serverId,
        installationId: null,
        aktion: AGENT_UPDATE_AKTION,
        argumente: { version },
        manifest: readFileSync(join(FIXTURES, "SHA256SUMS"), "utf8"),
        signatur: readFileSync(join(FIXTURES, "SHA256SUMS.minisig"), "utf8"),
      },
    );
    if (!r.ok) throw new Error(r.grund);
    const { auftragId } = r.auftrag;
    const ergebnis = { ok: true as const, daten: { version, vorher: VERSION } };
    for (const n of [
      { typ: "bestaetigt" as const, protokoll: PROTOKOLL_VERSION, auftragId },
      { typ: "ergebnis" as const, protokoll: PROTOKOLL_VERSION, auftragId, zeit: jetzt, ergebnis },
    ])
      auftragMelden(server.deps, zeile(), n, jetzt);
    server.deps.verbindungen.abmelden(betreiberId, serverId, alter);
  };
  return { server, melden, arten, aktualisiert };
};

describe("the agent's version at hallo", () => {
  it("writes an event when it rises and when it falls back, none when it stays", async () => {
    const { server, melden, arten } = await aufgebaut();
    expect(await melden(VERSION)).toEqual([
      expect.objectContaining({ typ: "willkommen", protokoll: PROTOKOLL_VERSION }),
    ]);
    expect(arten()).toEqual([]);
    server.stelleUhr(server.jetzt() + 1000);
    await melden(NEUER);
    server.stelleUhr(server.jetzt() + 1000);
    await melden(NEUER);
    server.stelleUhr(server.jetzt() + 1000);
    await melden(VERSION);
    expect(arten()).toEqual([
      [AGENT_ARTEN.aktualisiert, "info", `Agent von ${VERSION} auf ${NEUER}`],
      [AGENT_ARTEN.zurueckgekehrt, "fehler", `Agent zurück von ${NEUER} auf ${VERSION}`],
    ]);
  });

  it("writes an event when the old agent comes back after an update its new one never reported", async () => {
    const { server, melden, arten, aktualisiert } = await aufgebaut();
    await melden(VERSION);
    aktualisiert(NEUER);
    // the new agent never reached its Zentrale; after its check the old one says hallo again
    server.stelleUhr(server.jetzt() + 6 * 60_000);
    await melden(VERSION);
    server.stelleUhr(server.jetzt() + 1000);
    await melden(VERSION);
    expect(arten().map(([art, schwere]) => [art, schwere])).toEqual([
      [AGENT_ARTEN.zurueckgekehrt, "fehler"],
    ]);
  });

  it("writes no second event when the new agent reported and the old one came back later", async () => {
    const { server, melden, arten, aktualisiert } = await aufgebaut();
    await melden(VERSION);
    aktualisiert(NEUER);
    server.stelleUhr(server.jetzt() + 1000);
    await melden(NEUER);
    server.stelleUhr(server.jetzt() + 1000);
    await melden(VERSION);
    server.stelleUhr(server.jetzt() + 1000);
    await melden(VERSION);
    expect(arten().map(([art]) => art)).toEqual([
      AGENT_ARTEN.aktualisiert,
      AGENT_ARTEN.zurueckgekehrt,
    ]);
  });
});

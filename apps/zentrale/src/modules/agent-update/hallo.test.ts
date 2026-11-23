import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { ereignisse } from "../../db/schema.ts";
import { serverHinzufuegen } from "../../testhilfen/agent.ts";
import { testServer } from "../../testhilfen/server.ts";
import { agentBeitreten, fingerabdruckVon } from "../../testhilfen/tls.ts";
import { serverZumFingerabdruck } from "../server/index.ts";
import { sitzung } from "../verbindung/sitzung.ts";
import type { Sockel } from "../verbindung/verbindungen.ts";
import { AGENT_ARTEN } from "./ende.ts";

/*
 * BAULISTE.md Z-504: whether an update of the agent holds shows its next `hallo`. A newer version
 * than before is an event `agent_aktualisiert`, an older one `agent_zurueckgekehrt` (the old agent
 * came back); the same version again none.
 */
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
  return { server, melden, arten };
};

describe("the agent's version at hallo", () => {
  it("writes an event when it rises and when it falls back, none when it stays", async () => {
    const { server, melden, arten } = await aufgebaut();
    expect(await melden("0.0.0")).toEqual([
      expect.objectContaining({ typ: "willkommen", protokoll: PROTOKOLL_VERSION }),
    ]);
    expect(arten()).toEqual([]);
    server.stelleUhr(server.jetzt() + 1000);
    await melden("0.0.1");
    server.stelleUhr(server.jetzt() + 1000);
    await melden("0.0.1");
    server.stelleUhr(server.jetzt() + 1000);
    await melden("0.0.0");
    expect(arten()).toEqual([
      [AGENT_ARTEN.aktualisiert, "info", "Agent von 0.0.0 auf 0.0.1"],
      [AGENT_ARTEN.zurueckgekehrt, "fehler", "Agent zurück von 0.0.1 auf 0.0.0"],
    ]);
  });
});

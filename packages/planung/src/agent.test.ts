import { describe, expect, it } from "vitest";
import { type AgentServer, agentUpdatePruefen, VERSUCH_PAUSE_MS } from "./agent.ts";
import { instantVon } from "./zeit.ts";

/*
 * BAULISTE.md Z-504: when the Zentrale updates a server's agent. Only in the server's maintenance
 * window, never beside another job on the server, and at most one attempt per version a day.
 */
const berlin = (j: number, m: number, t: number, h = 12, min = 0) => instantVon(j, m, t, h, min);
const NACHTS = { tage: [0, 1, 2, 3, 4, 5, 6], von: "23:00", bis: "01:00" };

const server = (teil: Partial<AgentServer> = {}): AgentServer => ({
  agentVersion: "1.0.0",
  architektur: "amd64",
  wartungsfenster: NACHTS,
  verbunden: true,
  offeneAuftraege: 0,
  ...teil,
});

describe("agentUpdatePruefen", () => {
  it("updates an older agent inside its window, also past midnight", () => {
    expect(agentUpdatePruefen(server(), "1.1.0", berlin(2026, 11, 20, 23, 30))).toEqual({
      art: "jetzt",
    });
    expect(agentUpdatePruefen(server(), "1.1.0", berlin(2026, 11, 21, 0, 30))).toEqual({
      art: "jetzt",
    });
  });

  it("waits for the window outside it and names its start", () => {
    expect(agentUpdatePruefen(server(), "1.1.0", berlin(2026, 11, 20, 12))).toEqual({
      art: "warten",
      grund: "fenster",
      ab: berlin(2026, 11, 20, 23, 0),
    });
    expect(agentUpdatePruefen(server(), "1.1.0", berlin(2026, 11, 21, 1, 0))).toMatchObject({
      grund: "fenster",
    });
  });

  it("keeps an agent of this version or a newer one, and one never heard of", () => {
    const nachts = berlin(2026, 11, 20, 23, 30);
    expect(agentUpdatePruefen(server(), "1.0.0", nachts)).toEqual({
      art: "warten",
      grund: "aktuell",
    });
    expect(agentUpdatePruefen(server({ agentVersion: "1.2.0" }), "1.1.0", nachts)).toMatchObject({
      grund: "aktuell",
    });
    // a pre-release comes before its release (SemVer)
    expect(
      agentUpdatePruefen(server({ agentVersion: "1.1.0-rc.1" }), "1.1.0", nachts),
    ).toMatchObject({ art: "jetzt" });
    expect(agentUpdatePruefen(server({ agentVersion: null }), "1.1.0", nachts)).toMatchObject({
      grund: "unbekannt",
    });
    expect(agentUpdatePruefen(server({ architektur: null }), "1.1.0", nachts)).toMatchObject({
      grund: "unbekannt",
    });
  });

  it("waits for a connection and for every open job of the server", () => {
    const nachts = berlin(2026, 11, 20, 23, 30);
    expect(agentUpdatePruefen(server({ verbunden: false }), "1.1.0", nachts)).toMatchObject({
      grund: "getrennt",
    });
    expect(agentUpdatePruefen(server({ offeneAuftraege: 1 }), "1.1.0", nachts)).toMatchObject({
      grund: "auftraege",
    });
  });

  it("tries a version once a day", () => {
    const nachts = berlin(2026, 11, 20, 23, 30);
    const gestern = nachts - VERSUCH_PAUSE_MS;
    expect(
      agentUpdatePruefen(server({ letzterVersuchAm: gestern + 1 }), "1.1.0", nachts),
    ).toMatchObject({ art: "warten", grund: "versucht", ab: nachts + 1 });
    expect(
      agentUpdatePruefen(server({ letzterVersuchAm: gestern }), "1.1.0", nachts),
    ).toMatchObject({ art: "jetzt" });
  });
});

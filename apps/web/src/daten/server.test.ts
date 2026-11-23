import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../demo/server.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { agentAnzeige, apiServer, type ServerDerZentrale } from "./server.ts";

const JETZT = Date.UTC(2026, 10, 20, 12, 0, 0);

const beispiel: ServerDerZentrale = {
  serverId: "s1",
  name: "Gemeinsamer Server 3",
  art: "gemeinsam",
  kundeId: null,
  wartungsfenster: { tage: [1], von: "03:30", bis: "04:30" },
  angelegtAm: JETZT - 1000,
  beigetretenAm: JETZT - 500,
  architektur: "amd64",
  agentVersion: "0.0.0",
  zertifikatGueltigBis: JETZT + 1000,
  gesperrtAm: null,
  agent: { zustand: "verbunden", letzterHeartbeat: JETZT - 10 },
  fakten: null,
  faktenAm: null,
  neustart: { noetig: null, plan: { art: "warten", grund: "unbekannt" }, letzter: null },
};

describe("the API source of the servers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the list and one server, and revokes with a reason", async () => {
    const anfragen: string[] = [];
    vi.stubGlobal("fetch", async (pfad: string, init: RequestInit) => {
      anfragen.push(`${init.method ?? "GET"} ${pfad} ${init.body ?? ""}`.trim());
      return Response.json(pfad === "/api/v1/server" ? { server: [beispiel] } : beispiel);
    });
    expect(await apiServer.liste()).toEqual({ ok: true, status: 200, daten: [beispiel] });
    await apiServer.server("a/b");
    await apiServer.sperren("s1", "gestohlen");
    expect(anfragen).toEqual([
      "GET /api/v1/server",
      "GET /api/v1/server/a%2Fb",
      'POST /api/v1/server/s1/sperren {"grund":"gestohlen"}',
    ]);
  });
});

describe("agentAnzeige", () => {
  it("shows the last heartbeat, or the join before the first", () => {
    expect(agentAnzeige(beispiel)).toEqual({ zustand: "verbunden", letzteMeldung: JETZT - 10 });
    expect(
      agentAnzeige({ ...beispiel, agent: { zustand: "getrennt", letzterHeartbeat: null } }),
    ).toEqual({ zustand: "getrennt", letzteMeldung: JETZT - 500 });
  });
});

describe("the demo source of the servers", () => {
  it("answers as the API, with the state of each demo agent", async () => {
    const quelle = demoServerQuelle(server, () => JETZT);
    const liste = await quelle.liste();
    if (!liste.ok) throw new Error(liste.fehler);
    expect(liste.daten).toHaveLength(server.length);
    for (const sv of server) {
      const gefunden = liste.daten.find((s) => s.serverId === sv.id);
      expect(gefunden?.agent.zustand, sv.id).toBe(sv.agent.zustand);
    }
    expect(liste.daten.some((s) => s.agent.zustand === "still")).toBe(true);
  });

  it("revokes once, and the agent is disconnected after it", async () => {
    const quelle = demoServerQuelle(server, () => JETZT);
    const id = server[0]?.id ?? "";
    expect(await quelle.sperren(id, "weg")).toMatchObject({
      ok: true,
      daten: { gesperrtAm: JETZT, agent: { zustand: "getrennt" } },
    });
    expect(await quelle.sperren(id, "noch mal")).toMatchObject({ ok: false, status: 409 });
    expect(await quelle.server("gibt-es-nicht")).toMatchObject({ ok: false, status: 404 });
  });
});

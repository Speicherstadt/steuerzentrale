import { afterEach, describe, expect, it, vi } from "vitest";
import { apiInstallationen } from "./installationen.ts";

// BAULISTE.md Z-402: the dialog and the pages call the Zentrale's routes as docs/installieren.md
// names them, every write with its reason, and get a refusal back with its reasons as codes
describe("the API source of the installations", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mitschreiben = (antwort: unknown, status = 200) => {
    const anfragen: { pfad: string; method: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (pfad: string, init: RequestInit) => {
      anfragen.push({
        pfad,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(antwort, { status });
    });
    return anfragen;
  };

  const wunsch = {
    kundeId: "k1",
    serverId: "s1",
    app: "probe",
    version: "1.0.0",
    optionen: ["extra"],
  };

  it("reads the list and one installation", async () => {
    const anfragen = mitschreiben({ installationen: [{ installationId: "probe-abc123" }] });
    expect(await apiInstallationen.liste()).toEqual({
      ok: true,
      status: 200,
      daten: [{ installationId: "probe-abc123" }],
    });
    await apiInstallationen.installation("a/b");
    expect(anfragen.map((a) => `${a.method} ${a.pfad}`)).toEqual([
      "GET /api/v1/installationen",
      "GET /api/v1/installationen/a%2Fb",
    ]);
  });

  it("asks the placement without a reason and unwraps it", async () => {
    const anfragen = mitschreiben({ platzierung: { art: "passt", hinweise: [] } });
    expect(await apiInstallationen.platzierung(wunsch)).toEqual({
      ok: true,
      status: 200,
      daten: { art: "passt", hinweise: [] },
    });
    expect(anfragen).toEqual([
      { pfad: "/api/v1/installationen/platzierung", method: "POST", body: wunsch },
    ]);
  });

  it("makes and removes without a reason (Z-1207)", async () => {
    const anfragen = mitschreiben({});
    const neu = { ...wunsch, host: "probe.kunde.example", einstellungen: { PROBE_TITEL: "X" } };
    await apiInstallationen.anlegen(neu);
    await apiInstallationen.entfernen("probe-abc123");
    expect(anfragen).toEqual([
      {
        pfad: "/api/v1/installationen",
        method: "POST",
        body: neu,
      },
      {
        pfad: "/api/v1/installationen/probe-abc123",
        method: "DELETE",
        body: {},
      },
    ]);
  });

  it("hands a refusal back with its reasons and detail", async () => {
    const gruende = [{ code: "agent_getrennt", werte: {} }];
    mitschreiben({ fehler: "passt_nicht", gruende }, 409);
    expect(await apiInstallationen.platzierung(wunsch)).toEqual({
      ok: false,
      status: 409,
      fehler: "passt_nicht",
      gruende,
    });
    mitschreiben({ fehler: "manifest_ungueltig", detail: "id: required" }, 422);
    expect(await apiInstallationen.anlegen({ ...wunsch, host: "x.y", einstellungen: {} })).toEqual({
      ok: false,
      status: 422,
      fehler: "manifest_ungueltig",
      detail: "id: required",
    });
  });
});

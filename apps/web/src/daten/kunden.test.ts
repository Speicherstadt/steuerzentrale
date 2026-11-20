import { afterEach, describe, expect, it, vi } from "vitest";
import { kunden } from "../demo/kunden.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { apiKunden } from "./kunden.ts";

const stamm = { name: "Muster Design", kontakt: { name: "Mia Muster", email: "mia@muster.test" } };

describe("the API source of the customers", () => {
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

  it("reads the list and one customer", async () => {
    const anfragen = mitschreiben({ kunden: [kunden[1]] });
    expect(await apiKunden.liste()).toEqual({ ok: true, status: 200, daten: [kunden[1]] });
    await apiKunden.kunde("a/b");
    expect(anfragen.map((a) => `${a.method} ${a.pfad}`)).toEqual([
      "GET /api/v1/kunden",
      "GET /api/v1/kunden/a%2Fb",
    ]);
  });

  it("sends every write with its reason", async () => {
    const anfragen = mitschreiben(kunden[1]);
    await apiKunden.anlegen({ ...stamm, vertrag: { sla: "basis", beginn: 5 } }, "Vertrag");
    await apiKunden.aendern("k1", { ...stamm, beginn: 6 }, "Umzug");
    await apiKunden.kuendigen("k1", 7, "Mail");
    await apiKunden.zuruecknehmen("k1", "doch nicht");
    expect(anfragen).toEqual([
      {
        pfad: "/api/v1/kunden",
        method: "POST",
        body: { ...stamm, vertrag: { sla: "basis", beginn: 5 }, grund: "Vertrag" },
      },
      { pfad: "/api/v1/kunden/k1", method: "PUT", body: { ...stamm, beginn: 6, grund: "Umzug" } },
      { pfad: "/api/v1/kunden/k1/kuendigung", method: "PUT", body: { ende: 7, grund: "Mail" } },
      {
        pfad: "/api/v1/kunden/k1/kuendigung",
        method: "DELETE",
        body: { grund: "doch nicht" },
      },
    ]);
  });

  it("hands an error of the Zentrale back as a value", async () => {
    mitschreiben({ fehler: "kein_kunde" }, 404);
    expect(await apiKunden.kunde("x")).toEqual({ ok: false, status: 404, fehler: "kein_kunde" });
  });
});

describe("the demo source of the customers", () => {
  it("answers like the API: created, changed, given notice and taken back", async () => {
    const quelle = demoKunden(kunden, () => 42);
    const neu = await quelle.anlegen({ ...stamm, vertrag: { sla: "basis", beginn: 10 } }, "x");
    if (!neu.ok) throw new Error(neu.fehler);
    expect(neu.daten).toMatchObject({
      name: "Muster Design",
      kontakt: { telefon: null },
      notiz: null,
      angelegtAm: 42,
      vertrag: { sla: "basis", beginn: 10, ende: null },
    });
    const id = neu.daten.id;
    expect(await quelle.kuendigen(id, 5, "x")).toMatchObject({ status: 409 });
    expect(await quelle.kuendigen(id, 20, "x")).toMatchObject({ daten: { vertrag: { ende: 20 } } });
    expect(await quelle.aendern(id, { ...stamm, name: "Neu", beginn: 10 }, "x")).toMatchObject({
      daten: { name: "Neu", vertrag: { ende: 20 } },
    });
    expect(await quelle.zuruecknehmen(id, "x")).toMatchObject({
      daten: { vertrag: { ende: null } },
    });
    expect(await quelle.kunde("gibt-es-nicht")).toMatchObject({ ok: false, status: 404 });
    const liste = await quelle.liste();
    expect(liste.ok && liste.daten.map((k) => k.name)).toContain("Neu");
  });

  it("leaves the fixtures as they are", async () => {
    const quelle = demoKunden(kunden, () => 0);
    await quelle.kuendigen("atelier-nord", Date.UTC(2030, 0, 1), "x");
    expect(kunden.find((k) => k.id === "atelier-nord")?.vertrag.ende).toBeNull();
  });
});

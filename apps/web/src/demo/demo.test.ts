import { describe, expect, it } from "vitest";
import { demo } from "./index.ts";

// The fixtures stand in for the API: every reference must resolve, as the API's would
const ids = <T extends { id: string }>(liste: T[]) => liste.map((x) => x.id);

describe("demo fixtures", () => {
  it("show the apps with a released manifest in manifeste/, nothing still being built", () => {
    expect(ids(demo.apps)).toEqual([
      "haben",
      "belegt",
      "kontext",
      "schreibzeug",
      "stellwerk",
      "kennwort",
    ]);
  });

  it("have unique IDs per list", () => {
    const listen: { id: string }[][] = [demo.apps, demo.server, demo.kunden, demo.installationen];
    for (const liste of listen) expect(new Set(ids(liste)).size).toBe(liste.length);
  });

  it("point only at apps, customers and servers that exist", () => {
    const apps = new Set(ids(demo.apps));
    const kunden = new Set(ids(demo.kunden));
    const server = new Set(ids(demo.server));
    for (const i of demo.installationen) {
      expect(apps.has(i.app), i.id).toBe(true);
      expect(kunden.has(i.kunde), i.id).toBe(true);
      expect(server.has(i.server), i.id).toBe(true);
    }
    const installationen = new Set(ids(demo.installationen));
    const ziele = [...demo.ereignisse, ...demo.auftraege, ...demo.audit].map((x) => x.ziel);
    for (const ziel of ziele) {
      if (ziel.art === "installation") expect(installationen.has(ziel.id), ziel.id).toBe(true);
      if (ziel.art === "server") expect(server.has(ziel.id), ziel.id).toBe(true);
      if (ziel.art === "app") expect(apps.has(ziel.id), ziel.id).toBe(true);
    }
  });

  it("take each app's version from its newest released manifest", () => {
    expect(Object.fromEntries(demo.apps.map((a) => [a.id, a.version]))).toEqual({
      haben: "0.12.0",
      belegt: "0.0.7",
      kontext: "0.1.37",
      schreibzeug: "0.1.26",
      stellwerk: "0.1.12",
      kennwort: "0.1.3",
    });
  });

  it("use only options and architectures the manifest knows", () => {
    for (const i of demo.installationen) {
      const app = demo.apps.find((a) => a.id === i.app);
      const server = demo.server.find((s) => s.id === i.server);
      expect(app?.architektur, i.id).toContain(server?.arch);
      for (const o of i.optionen)
        expect(
          app?.optionen.map((x) => x.id),
          i.id,
        ).toContain(o);
    }
  });
});

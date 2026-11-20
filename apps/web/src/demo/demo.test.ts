import { describe, expect, it } from "vitest";
import { demo } from "./index.ts";

// The fixtures stand in for the API: every reference must resolve, as the API's would
const ids = <T extends { id: string }>(liste: T[]) => liste.map((x) => x.id);

describe("demo fixtures", () => {
  it("show the eight apps of the Speicherstadt (docs/plan.md)", () => {
    expect(ids(demo.apps)).toEqual([
      "haben",
      "belegt",
      "kontext",
      "schreibzeug",
      "stellwerk",
      "fixpunkt",
      "kennwort",
      "soll",
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
    for (const z of demo.zugaenge) expect(installationen.has(z.installation), z.id).toBe(true);
  });

  it("keep Kennwort and Soll without image and the others installable", () => {
    const ohne = demo.apps.filter((a) => a.version === null).map((a) => a.id);
    expect(ohne).toEqual(["kennwort", "soll"]);
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

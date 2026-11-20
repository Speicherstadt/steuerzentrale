import { describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import { serverVon } from "./ableitungen.ts";
import type { Bestand, Installation, Server } from "./typen.ts";
import { aufmerksamkeit, pruefungen, serverZustand, zaehler } from "./zustand.ts";

const mit = (id: string, aenderung: Partial<Server>): Bestand => ({
  ...demo,
  server: demo.server.map((s) => (s.id === id ? { ...s, ...aenderung } : s)),
});

describe("server checks", () => {
  it("are all fine on a healthy server", () => {
    const sv = serverVon(demo, "shared-1");
    expect(pruefungen(demo, sv).filter((p) => !p.ok)).toEqual([]);
    expect(serverZustand(demo, sv)).toBe("ok");
  });

  it("warn from 80 % disk and mark the server from 90 %", () => {
    const platte = (prozent: number) =>
      pruefungen(mit("shared-1", { platte: prozent }), {
        ...serverVon(demo, "shared-1"),
        platte: prozent,
      }).find((p) => p.art === "platte");
    expect(platte(79)).toMatchObject({ ok: true, grenze: null });
    expect(platte(80)).toMatchObject({ ok: false, grenze: 80 });
    expect(platte(91)).toMatchObject({ ok: false, grenze: 90 });
    expect(serverZustand(demo, serverVon(demo, "lind"))).toBe("platte");
  });

  it("put a silent agent before everything else", () => {
    expect(serverZustand(demo, serverVon(demo, "kraft"))).toBe("agent");
  });

  it("flag a running kernel older than the installed one", () => {
    const kernel = pruefungen(demo, serverVon(demo, "shared-2")).find((p) => p.art === "kernel");
    expect(kernel).toMatchObject({ ok: false, laeuft: "6.12.41", installiert: "6.12.48" });
    expect(serverZustand(demo, serverVon(demo, "shared-2"))).toBe("neustart");
  });

  it("open ports 80 and 443 plus the manifests' ports", () => {
    const ports = pruefungen(demo, serverVon(demo, "shared-2")).find((p) => p.art === "ports");
    expect(ports).toMatchObject({ ports: ["80", "443"] });
    const b: Bestand = {
      ...demo,
      installationen: [
        ...demo.installationen,
        {
          ...demo.installationen[0],
          id: "x-stellwerk",
          app: "stellwerk",
          server: "shared-2",
        } as Installation,
      ],
    };
    expect(pruefungen(b, serverVon(b, "shared-2")).find((p) => p.art === "ports")).toMatchObject({
      ports: ["80", "443", "22001/tcp"],
    });
  });
});

describe("what needs attention", () => {
  it("comes worst first", () => {
    const rang = { krit: 0, warn: 1, info: 2 };
    const schweren = aufmerksamkeit(demo).map((h) => rang[h.schwere]);
    expect(schweren).toEqual([...schweren].sort((a, b) => a - b));
    expect(aufmerksamkeit(demo)[0]?.schwere).toBe("krit");
  });

  it("names a failed job only when its target is not listed already", () => {
    const auftraege = aufmerksamkeit(demo).filter((h) => h.art === "auftrag");
    // berger-schreibzeug is red and lind-haben yellow: their failed jobs do not repeat them
    expect(auftraege).toEqual([]);
  });

  it("leaves cancelled installations out of health warnings", () => {
    const b: Bestand = {
      ...demo,
      installationen: demo.installationen.map((i) =>
        i.id === "sonne-haben" ? { ...i, health: "rot", grund: "x" } : i,
      ),
    };
    expect(
      aufmerksamkeit(b).some((h) => "installation" in h && h.installation.id === "sonne-haben"),
    ).toBe(false);
  });
});

describe("sidebar counters", () => {
  it("count only what there is to do", () => {
    expect(zaehler(demo)).toEqual({ updates: 2, auftraege: 2, support: 1, ereignisse: 5 });
  });
});

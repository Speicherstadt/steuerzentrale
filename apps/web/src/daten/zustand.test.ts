import { describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import { serverVon } from "./ableitungen.ts";
import type { Bestand, Server } from "./typen.ts";
import { pruefungen, pruefungenDerDemo, serverZustand, zaehler } from "./zustand.ts";

const mit = (id: string, aenderung: Partial<Server>): Bestand => ({
  ...demo,
  server: demo.server.map((s) => (s.id === id ? { ...s, ...aenderung } : s)),
});

const pruefung = (b: Bestand, id: string, name: string) =>
  pruefungenDerDemo(b, serverVon(b, id)).find((p) => p.pruefung === name);

describe("server checks", () => {
  it("are all fine on a healthy server", () => {
    const sv = serverVon(demo, "shared-1");
    expect(pruefungen(sv).filter((p) => !p.ok)).toEqual([]);
    expect(pruefungenDerDemo(demo, sv).map((p) => p.ergebnis)).toEqual(Array(5).fill("gruen"));
    expect(serverZustand(demo, sv)).toBe("ok");
  });

  // BAULISTE.md Z-702, the limits of packages/planung: over 80 % yellow, over 90 % red
  it("warn over 80 % disk and mark the server over 90 %", () => {
    const platte = (prozent: number) =>
      pruefung(mit("shared-1", { platte: prozent }), "shared-1", "platte")?.ergebnis;
    expect(platte(80)).toBe("gruen");
    expect(platte(81)).toBe("gelb");
    expect(platte(90)).toBe("gelb");
    expect(platte(91)).toBe("rot");
    const zustand = (prozent: number) => {
      const b = mit("shared-1", { platte: prozent });
      return serverZustand(b, serverVon(b, "shared-1"));
    };
    expect(zustand(80)).toBe("ok");
    expect(zustand(90)).toBe("pruefen");
    expect(zustand(91)).toBe("platte");
    expect(serverZustand(demo, serverVon(demo, "lind"))).toBe("platte");
  });

  it("warn of a certificate within 14 days and a clock off by 500 ms", () => {
    const b = mit("shared-1", { zertifikatTage: 14, uhrAbweichungMs: 500 });
    expect(pruefung(b, "shared-1", "zertifikate")?.ergebnis).toBe("gelb");
    expect(pruefung(b, "shared-1", "uhrzeit")?.ergebnis).toBe("gelb");
    expect(serverZustand(b, serverVon(b, "shared-1"))).toBe("pruefen");
    const gut = mit("shared-1", { zertifikatTage: 15, uhrAbweichungMs: 499 });
    expect(pruefung(gut, "shared-1", "zertifikate")?.ergebnis).toBe("gruen");
    expect(pruefung(gut, "shared-1", "uhrzeit")?.ergebnis).toBe("gruen");
  });

  it("name an installation whose last good backup is older than 26 h", () => {
    const backups = demo.server
      .map((sv) => pruefung(demo, sv.id, "backups"))
      .filter((p) => p?.ergebnis === "gelb");
    expect(backups).toHaveLength(1);
  });

  it("put a silent agent before everything else", () => {
    expect(serverZustand(demo, serverVon(demo, "kraft"))).toBe("agent");
  });

  it("flag a running kernel older than the installed one", () => {
    const kernel = pruefungen(serverVon(demo, "shared-2")).find((p) => p.art === "kernel");
    expect(kernel).toMatchObject({ ok: false, laeuft: "6.12.41", installiert: "6.12.48" });
    expect(serverZustand(demo, serverVon(demo, "shared-2"))).toBe("neustart");
  });
});

describe("sidebar counters", () => {
  it("count only what there is to do", () => {
    expect(zaehler(demo)).toEqual({ updates: 2, auftraege: 2, support: 1, ereignisse: 5 });
  });
});

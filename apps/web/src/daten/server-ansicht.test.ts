import { describe, expect, it } from "vitest";
import { alsServerDerZentrale } from "../demo/server-quelle.ts";
import { bestand } from "./quelle.ts";
import type { ServerDerZentrale, ServerFakten } from "./server.ts";
import { ansichtZustand, serverAnsicht } from "./server-ansicht.ts";
import { serverZustand } from "./zustand.ts";

const JETZT = Date.UTC(2026, 10, 20, 12, 0, 0);

const FAKTEN: ServerFakten = {
  zeit: JETZT,
  cpuKerne: 4,
  ramMb: 8192,
  platten: [
    { mount: "/", gesamtMb: 20_480, freiMb: 10_240 },
    { mount: "/home", gesamtMb: 512_000, freiMb: 25_600 },
  ],
  architektur: "arm64",
  os: { name: "Debian GNU/Linux", version: "13" },
  kernel: { laeuft: "6.12.41", installiert: "6.12.48" },
  neustartNoetig: true,
  updatesAusstehend: 3,
  podman: "5.4.2",
  ipv4: ["203.0.113.10", "10.8.0.1"],
  ipv6: [],
  ptr: { "203.0.113.10": "server-a.example.org" },
  portsBelegt: [
    { port: 22, proto: "tcp" },
    { port: 443, proto: "udp" },
  ],
  port25Ausgehend: false,
  uhrzeitAbweichungMs: 12,
};

const sv = (aenderung: Partial<ServerDerZentrale> = {}): ServerDerZentrale => ({
  serverId: "s1",
  name: "Gemeinsamer Server 3",
  art: "beim_kunden",
  kundeId: "k1",
  wartungsfenster: { tage: [1], von: "03:30", bis: "04:30" },
  angelegtAm: JETZT - 1000,
  beigetretenAm: JETZT - 500,
  architektur: "amd64",
  agentVersion: "0.1.0",
  zertifikatGueltigBis: JETZT + 1000,
  gesperrtAm: null,
  agent: { zustand: "verbunden", letzterHeartbeat: JETZT - 10 },
  fakten: FAKTEN,
  faktenAm: JETZT - 60_000,
  ...aenderung,
});

describe("a server as the pages show it (Z-304)", () => {
  it("shows the agent's facts as they came", () => {
    expect(serverAnsicht(sv(), undefined)).toMatchObject({
      id: "s1",
      art: "kunde",
      kunde: "k1",
      host: "server-a.example.org",
      os: "Debian GNU/Linux 13",
      arch: "arm64",
      kernel: { laeuft: "6.12.41", installiert: "6.12.48" },
      podman: "5.4.2",
      cpuKerne: 4,
      ramGb: 8,
      platten: [
        { mount: "/", prozent: 50, gesamtGb: 20 },
        { mount: "/home", prozent: 95, gesamtGb: 500 },
      ],
      platte: 95,
      updates: 3,
      neustart: true,
      ipv4: ["203.0.113.10", "10.8.0.1"],
      ports: ["22/tcp", "443/udp"],
      port25: false,
      uhrMs: 12,
      wartung: { von: "03:30", bis: "04:30" },
      agent: { version: "0.1.0", zustand: "verbunden", letzteMeldung: JETZT - 10 },
      faktenAm: JETZT - 60_000,
      demo: undefined,
    });
  });

  it("invents nothing for a server without facts", () => {
    expect(serverAnsicht(sv({ fakten: null, faktenAm: null }), undefined)).toMatchObject({
      host: null,
      os: null,
      arch: "amd64",
      kernel: { laeuft: null, installiert: null },
      ramGb: null,
      platten: null,
      platte: null,
      updates: null,
      neustart: null,
      ipv4: null,
      ports: null,
      port25: null,
      faktenAm: null,
    });
  });

  it("says in one word what needs a look", () => {
    const b = bestand();
    const zustand = (a: Partial<ServerDerZentrale>) =>
      ansichtZustand(b, serverAnsicht(sv(a), undefined));
    expect(zustand({})).toBe("platte");
    const ruhig = { ...FAKTEN, platten: [], neustartNoetig: false, updatesAusstehend: 0 };
    expect(zustand({ fakten: ruhig })).toBe("ok");
    expect(zustand({ fakten: { ...ruhig, neustartNoetig: true } })).toBe("neustart");
    expect(zustand({ fakten: { ...ruhig, updatesAusstehend: 1 } })).toBe("pruefen");
    expect(zustand({ fakten: { ...ruhig, uhrzeitAbweichungMs: -900 } })).toBe("pruefen");
    expect(zustand({ fakten: null, faktenAm: null })).toBe("pruefen");
    expect(zustand({ agent: { zustand: "getrennt", letzterHeartbeat: null } })).toBe("agent");
  });

  it("never says ok for a disk or reboot state the agent could not read", () => {
    const b = bestand();
    const zustand = (a: Partial<ServerDerZentrale>) =>
      ansichtZustand(b, serverAnsicht(sv(a), undefined));
    const ruhig = { ...FAKTEN, platten: [], neustartNoetig: false, updatesAusstehend: 0 };
    expect(zustand({ fakten: { ...ruhig, platten: null } })).toBe("pruefen");
    expect(zustand({ fakten: { ...ruhig, neustartNoetig: null } })).toBe("pruefen");
  });

  it("keeps the demo's look: the demo source's facts give the demo's values", () => {
    const b = bestand();
    for (const demo of b.server) {
      const a = serverAnsicht(alsServerDerZentrale(demo, b.jetzt), demo);
      expect(
        [a.host, a.os, a.arch, a.ramGb, a.platte, a.kernel, a.podman, a.updates, a.uhrMs],
        demo.id,
      ).toEqual([
        demo.host,
        demo.os,
        demo.arch,
        demo.ramGb,
        demo.platte,
        demo.kernel,
        demo.podman,
        demo.sicherheitsupdates,
        demo.uhrAbweichungMs,
      ]);
      expect(a.ipv4?.join(""), demo.id).toBe(demo.ipv4);
      expect(ansichtZustand(b, a), demo.id).toBe(serverZustand(b, demo));
    }
  });
});

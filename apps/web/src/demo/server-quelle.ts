import type { ServerDerZentrale, ServerFakten, ServerQuelle } from "../daten/server.ts";
import type { Server } from "../daten/typen.ts";
import { pruefungenDerDemo } from "../daten/zustand.ts";
import { demo } from "./index.ts";

/**
 * The demo's servers, answering as the Zentrale's API would (routes/server.ts in apps/zentrale), a
 * server's own page with its checks (Z-702) as packages/planung rates the demo's values; a
 * revocation lasts until the page reloads
 */
const ARTEN = { gemeinsam: "gemeinsam", eigen: "eigen", kunde: "beim_kunden" } as const;

const STILL_AB_MS = 75_000;
const MIB_200_GB = 200 * 1024;

/**
 * The demo server's values as its agent would report them (Z-304); the disk is a 200 GB root with
 * the demo's share in use, the host name its PTR
 */
export const demoFakten = (sv: Server, jetzt: number): ServerFakten => {
  const [name = sv.os, version = ""] = sv.os.split(" ");
  return {
    zeit: jetzt,
    cpuKerne: null,
    ramMb: sv.ramGb * 1024,
    platten: [
      {
        mount: "/",
        gesamtMb: MIB_200_GB,
        freiMb: Math.round((MIB_200_GB * (100 - sv.platte)) / 100),
      },
    ],
    architektur: sv.arch === "arm64" ? "arm64" : "amd64",
    os: { name, version },
    kernel: sv.kernel,
    neustartNoetig: sv.neustart !== undefined || sv.kernel.laeuft !== sv.kernel.installiert,
    updatesAusstehend: sv.sicherheitsupdates,
    podman: sv.podman,
    ipv4: sv.ipv4 ? [sv.ipv4] : [],
    ipv6: sv.ipv6 ? [sv.ipv6] : [],
    ptr: sv.ipv4 ? { [sv.ipv4]: sv.host } : {},
    portsBelegt: [
      { port: 22, proto: "tcp" },
      { port: 80, proto: "tcp" },
      { port: 443, proto: "tcp" },
    ],
    port25Ausgehend: null,
    uhrzeitAbweichungMs: sv.uhrAbweichungMs,
  };
};

export const alsServerDerZentrale = (sv: Server, jetzt: number): ServerDerZentrale => {
  const letzterHeartbeat = sv.agent.letzteMeldung;
  const faktenAm = sv.agent.zustand === "verbunden" ? jetzt : letzterHeartbeat;
  const agent: ServerDerZentrale["agent"] =
    sv.agent.zustand === "still"
      ? {
          zustand: "still",
          letzterHeartbeat,
          stillSeitMin: Math.floor(Math.max(jetzt - letzterHeartbeat, STILL_AB_MS) / 60_000),
        }
      : { zustand: sv.agent.zustand, letzterHeartbeat };
  return {
    serverId: sv.id,
    name: sv.name,
    art: ARTEN[sv.art],
    kundeId: sv.kunde ?? null,
    wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], ...sv.wartung },
    angelegtAm: jetzt - sv.laufzeitTage * 24 * 3600_000,
    beigetretenAm: jetzt - sv.laufzeitTage * 24 * 3600_000,
    architektur: sv.arch === "arm64" ? "arm64" : "amd64",
    agentVersion: sv.agent.version,
    zertifikatGueltigBis: jetzt + sv.zertifikatTage * 24 * 3600_000,
    gesperrtAm: null,
    agent,
    // a silent agent's facts are those of its last report
    fakten: demoFakten(sv, faktenAm),
    faktenAm,
  };
};

export const demoServerQuelle = (start: Server[], jetzt: () => number): ServerQuelle => {
  let liste = start.map((sv) => alsServerDerZentrale(sv, jetzt()));
  const fehlt = { ok: false, status: 404, fehler: "kein_server" } as const;
  const ok = <T>(daten: T) => ({ ok: true, status: 200, daten }) as const;
  return {
    liste: async () => ok([...liste].sort((a, b) => a.name.localeCompare(b.name, "de"))),
    server: async (id) => {
      const sv = liste.find((s) => s.serverId === id);
      const roh = start.find((s) => s.id === id);
      if (!sv || !roh) return fehlt;
      // at the demo's own morning, which its backups and certificates are written against
      const pruefungen = pruefungenDerDemo({ ...demo, server: start }, roh).map((p) => ({
        ...p,
        seit: null,
      }));
      return ok({ ...sv, pruefungen });
    },
    sperren: async (id) => {
      const sv = liste.find((s) => s.serverId === id);
      if (!sv) return fehlt;
      if (sv.gesperrtAm !== null) return { ok: false, status: 409, fehler: "schon_gesperrt" };
      const neu: ServerDerZentrale = {
        ...sv,
        gesperrtAm: jetzt(),
        agent: { zustand: "getrennt", letzterHeartbeat: sv.agent.letzterHeartbeat },
      };
      liste = liste.map((s) => (s.serverId === id ? neu : s));
      return ok(neu);
    },
  };
};

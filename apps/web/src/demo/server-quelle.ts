import type { ServerDerZentrale, ServerQuelle } from "../daten/server.ts";
import type { Server } from "../daten/typen.ts";

/**
 * The demo's servers, answering as the Zentrale's API would (routes/server.ts in apps/zentrale);
 * a revocation lasts until the page reloads
 */
const ARTEN = { gemeinsam: "gemeinsam", eigen: "eigen", kunde: "beim_kunden" } as const;

const STILL_AB_MS = 75_000;

export const alsServerDerZentrale = (sv: Server, jetzt: number): ServerDerZentrale => {
  const letzterHeartbeat = sv.agent.letzteMeldung;
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
      return sv ? ok(sv) : fehlt;
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

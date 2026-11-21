import { type Antwort, api } from "../anmeldung/api.ts";
import { server as demoServer } from "../demo/server.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import type { AgentZustand } from "./typen.ts";

/*
 * Where the server pages read the servers of the Zentrale (BAULISTE.md Z-303, Z-304): the API once
 * someone is signed in (main.tsx puts it in), else the demo fixtures in memory. It carries what the
 * API has: the servers, what the agent reported at joining, the state of its connection and its
 * newest facts. Load, installations, checks and events still come from the demo data by the
 * server's id (server-ansicht.ts), so a server of the Zentrale has none of them yet.
 */

/** The facts of a server as its agent read them (packages/protokoll, `fakten`); null: unreadable */
export type ServerFakten = {
  zeit: number;
  cpuKerne: number | null;
  ramMb: number | null;
  platten: { mount: string; gesamtMb: number; freiMb: number }[] | null;
  architektur: "amd64" | "arm64" | null;
  os: { name: string; version: string } | null;
  kernel: { laeuft: string | null; installiert: string | null };
  neustartNoetig: boolean | null;
  updatesAusstehend: number | null;
  podman: string | null;
  ipv4: string[] | null;
  ipv6: string[] | null;
  ptr: Record<string, string>;
  portsBelegt: { port: number; proto: "tcp" | "udp" }[] | null;
  port25Ausgehend: boolean | null;
  uhrzeitAbweichungMs: number | null;
};

/** The state of a server's agent (apps/zentrale, modules/verbindung/zustand.ts) */
export type AgentVerbindung =
  | { zustand: "verbunden"; letzterHeartbeat: number | null }
  | { zustand: "still"; letzterHeartbeat: number | null; stillSeitMin: number }
  | { zustand: "getrennt"; letzterHeartbeat: number | null };

/** A server as GET /api/v1/server answers it */
export type ServerDerZentrale = {
  serverId: string;
  name: string;
  art: "gemeinsam" | "eigen" | "beim_kunden";
  kundeId: string | null;
  wartungsfenster: { tage: number[]; von: string; bis: string };
  angelegtAm: number;
  beigetretenAm: number | null;
  architektur: "amd64" | "arm64" | null;
  agentVersion: string | null;
  zertifikatGueltigBis: number | null;
  gesperrtAm: number | null;
  agent: AgentVerbindung;
  /** The newest facts and when the Zentrale got them; null before the agent's first report */
  fakten: ServerFakten | null;
  faktenAm: number | null;
};

export type ServerQuelle = {
  liste: () => Promise<Antwort<ServerDerZentrale[]>>;
  server: (id: string) => Promise<Antwort<ServerDerZentrale>>;
  /** Revokes the server's certificate: its agent is refused from now on */
  sperren: (id: string, grund: string) => Promise<Antwort<ServerDerZentrale>>;
};

const pfad = (id: string) => `/api/v1/server/${encodeURIComponent(id)}`;

export const apiServer: ServerQuelle = {
  liste: async () => {
    const antwort = await api<{ server: ServerDerZentrale[] }>("/api/v1/server");
    return antwort.ok ? { ...antwort, daten: antwort.daten.server } : antwort;
  },
  server: (id) => api<ServerDerZentrale>(pfad(id)),
  sperren: (id, grund) => api<ServerDerZentrale>(`${pfad(id)}/sperren`, { body: { grund } }),
};

/**
 * The agent as the pages show it (AgentZeichen): its state and the instant of its last sign of
 * life, a heartbeat or, before the first, the join
 */
export const agentAnzeige = (
  sv: ServerDerZentrale,
): { zustand: AgentZustand; letzteMeldung: number | null } => ({
  zustand: sv.agent.zustand,
  letzteMeldung: sv.agent.letzterHeartbeat ?? sv.beigetretenAm,
});

let quelle: ServerQuelle = demoServerQuelle(demoServer, Date.now);

export const serverQuelle = (): ServerQuelle => quelle;

export const serverQuelleEinsetzen = (neu: ServerQuelle): void => {
  quelle = neu;
};

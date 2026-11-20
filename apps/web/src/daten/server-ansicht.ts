import { agentAnzeige, type ServerDerZentrale } from "./server.ts";
import type { AgentZustand, Art, Bestand, Server } from "./typen.ts";
import { PLATTE_STOERUNG, type ServerZustand, serverZustand } from "./zustand.ts";

/*
 * A server as the server pages show it (BAULISTE.md Z-304): what the Zentrale's API has, its facts
 * included, and nothing invented. A fact the agent could not read, or a server without facts yet,
 * stays null and the page says so. Load, provider, the reboot job and the checks exist only in the
 * demo data (`demo`, by the server's id) until their items bring them.
 */

export type PlattenAnsicht = { mount: string; prozent: number; gesamtGb: number };

export type ServerAnsicht = {
  id: string;
  name: string;
  art: Art;
  kunde: string | null;
  /** The PTR name of its first IPv4 address */
  host: string | null;
  os: string | null;
  arch: string | null;
  kernel: { laeuft: string | null; installiert: string | null };
  podman: string | null;
  cpuKerne: number | null;
  ramGb: number | null;
  platten: PlattenAnsicht[] | null;
  /** The fullest disk in percent */
  platte: number | null;
  updates: number | null;
  neustart: boolean | null;
  ipv4: string[] | null;
  ipv6: string[] | null;
  ptr: Record<string, string>;
  ports: string[] | null;
  port25: boolean | null;
  uhrMs: number | null;
  wartung: { von: string; bis: string };
  agent: { version: string | null; zustand: AgentZustand; letzteMeldung: number | null };
  faktenAm: number | null;
  demo: Server | undefined;
};

const ARTEN = { gemeinsam: "gemeinsam", eigen: "eigen", beim_kunden: "kunde" } as const;

const prozent = (p: { gesamtMb: number; freiMb: number }) =>
  p.gesamtMb > 0 ? Math.round(((p.gesamtMb - p.freiMb) / p.gesamtMb) * 100) : 0;

const plattenAnsicht = (f: ServerDerZentrale["fakten"]): PlattenAnsicht[] | null =>
  f?.platten?.map((p) => ({
    mount: p.mount,
    prozent: prozent(p),
    gesamtGb: Math.round(p.gesamtMb / 1024),
  })) ?? null;

/** The server of the API with its demo extras, if the demo data know its id */
export const serverAnsicht = (sv: ServerDerZentrale, demo: Server | undefined): ServerAnsicht => {
  const f = sv.fakten;
  const platten = plattenAnsicht(f);
  const ersteIpv4 = f?.ipv4?.[0];
  return {
    id: sv.serverId,
    name: sv.name,
    art: ARTEN[sv.art],
    kunde: sv.kundeId,
    host: (ersteIpv4 && f?.ptr[ersteIpv4]) || null,
    os: f?.os ? `${f.os.name} ${f.os.version}`.trim() : null,
    arch: f?.architektur ?? sv.architektur,
    kernel: f?.kernel ?? { laeuft: null, installiert: null },
    podman: f?.podman ?? null,
    cpuKerne: f?.cpuKerne ?? null,
    ramGb: f?.ramMb ? Math.round(f.ramMb / 1024) : null,
    platten,
    platte: platten?.length ? Math.max(...platten.map((p) => p.prozent)) : null,
    updates: f?.updatesAusstehend ?? null,
    neustart: f?.neustartNoetig ?? null,
    ipv4: f?.ipv4 ?? null,
    ipv6: f?.ipv6 ?? null,
    ptr: f?.ptr ?? {},
    ports: f?.portsBelegt?.map((p) => `${p.port}/${p.proto}`) ?? null,
    port25: f?.port25Ausgehend ?? null,
    uhrMs: f?.uhrzeitAbweichungMs ?? null,
    wartung: { von: sv.wartungsfenster.von, bis: sv.wartungsfenster.bis },
    agent: { version: sv.agentVersion, ...agentAnzeige(sv) },
    faktenAm: sv.faktenAm,
    demo,
  };
};

const UHR_GRENZE_MS = 500;

/**
 * One word for the server: the demo's checks where the demo knows it, else from the agent and the
 * facts alone; a server without facts asks to be looked at
 */
export const ansichtZustand = (b: Bestand, a: ServerAnsicht): ServerZustand => {
  if (a.agent.zustand !== "verbunden") return "agent";
  if (a.demo) return serverZustand(b, a.demo);
  if (a.platte !== null && a.platte >= PLATTE_STOERUNG) return "platte";
  if (a.neustart) return "neustart";
  const alleBekannt = a.faktenAm !== null && a.updates !== null && a.uhrMs !== null;
  const gut = a.updates === 0 && Math.abs(a.uhrMs ?? 0) < UHR_GRENZE_MS;
  return alleBekannt && gut ? "ok" : "pruefen";
};

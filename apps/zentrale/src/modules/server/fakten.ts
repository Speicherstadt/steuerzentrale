import type { PlatzServer } from "@steuerzentrale/manifest";
import { Fakten } from "@steuerzentrale/protokoll";
import type { Server } from "./server.ts";

/*
 * A server's facts as the Zentrale keeps them (BAULISTE.md Z-304): the newest `fakten` message at
 * the server, and what placement reads of them. Placement takes the agent's values as they came,
 * so there is one source for both, and it refuses to guess a fact the agent could not read.
 */

export type ServerFakten = typeof Fakten._output;

/** The newest facts of a server, or null before the first or when the stored text is not one */
export const serverFakten = (sv: Pick<Server, "fakten">): ServerFakten | null => {
  if (sv.fakten === null) return null;
  try {
    const gelesen = Fakten.safeParse(JSON.parse(sv.fakten));
    return gelesen.success ? gelesen.data : null;
  } catch {
    return null;
  }
};

/**
 * Whether the server's agent reports that it is only observed (Z-1102): the Zentrale makes no job
 * that changes it and places nothing there; the agent refuses such jobs in any case
 */
export const nurBeobachtet = (sv: Pick<Server, "fakten">): boolean =>
  serverFakten(sv)?.nurBeobachten === true;

/** Installations live in the home directories of their users (`sz-<installation>`) */
const INSTALLATIONEN = "/home/sz-";

/** The mounted file system that holds `pfad`: the mount point that is its longest prefix */
export const mountFuer = <P extends { mount: string }>(platten: P[], pfad: string): P | undefined =>
  platten
    .filter((p) => p.mount === "/" || pfad === p.mount || pfad.startsWith(`${p.mount}/`))
    .sort((a, b) => b.mount.length - a.mount.length)[0];

export type PlatzServerErgebnis =
  | { ok: true; server: PlatzServer }
  | { ok: false; fehlt: string[] };

/**
 * What placement needs of a server, from its row and facts: what the agent could not read is named,
 * not filled in. The architecture falls back to the one the agent named in `hallo`.
 */
export const platzServer = (
  sv: Pick<Server, "betreiberId" | "architektur">,
  f: ServerFakten | null,
  agentVerbunden: boolean,
): PlatzServerErgebnis => {
  const architektur = f?.architektur ?? (sv.architektur as PlatzServer["architektur"] | null);
  const platte = f?.platten ? mountFuer(f.platten, INSTALLATIONEN) : undefined;
  const fehlt = [
    ...(architektur ? [] : ["architektur"]),
    ...(f?.ramMb ? [] : ["ramMb"]),
    ...(platte ? [] : ["platte"]),
    ...(f?.ipv4 ? [] : ["ipv4"]),
    ...(f?.portsBelegt ? [] : ["portsBelegt"]),
  ];
  if (!f || !architektur || !f.ramMb || !platte || !f.ipv4 || !f.portsBelegt)
    return { ok: false, fehlt };
  return {
    ok: true,
    server: {
      betreiberId: sv.betreiberId,
      agentVerbunden,
      nurBeobachten: f.nurBeobachten === true,
      architektur,
      ramMb: f.ramMb,
      platteFreiMb: platte.freiMb,
      platteGesamtMb: platte.gesamtMb,
      ipv4: f.ipv4,
      ptr: f.ptr,
      port25Ausgehend: f.port25Ausgehend,
      portsBelegt: f.portsBelegt,
    },
  };
};

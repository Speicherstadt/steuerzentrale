import { AGENT_UPDATE_AKTION } from "@steuerzentrale/manifest";
import { type AgentServer, agentUpdatePruefen } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, betreiber, server } from "../../db/schema.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import { auftragAnlegen } from "../auftraege/index.ts";
import type { AuftragDeps } from "../auftraege/zustellen.ts";
import type { AgentStand } from "../server/auslieferung.ts";
import { wartungsfensterLesen } from "../updates/plan.ts";

/*
 * The update of the agents (BAULISTE.md Z-504; docs/plan.md, "Update des Agenten"): every minute
 * the Zentrale compares each joined server's agent version (from its last `hallo`) with the
 * release in STEUERZENTRALE_AGENT_DATEIEN (VERSION, SHA256SUMS and its signature, as served) and,
 * when packages/planung `agentUpdatePruefen` says now (an older agent, connected, in the server's
 * maintenance window, no other job open on the server, this version not tried in the last day),
 * makes the built-in job `agent_update` with SHA256SUMS and its signature, as the system. The jobs
 * and the servers' rows are the state: a restart of the Zentrale changes nothing.
 */

export const AGENT_UPDATE_PLANUNG_MS = 60_000;

export type AgentPlanungsDeps = AuftragDeps & {
  /** The release the agents are updated to; none without the agent files */
  agentStand: () => Promise<AgentStand | undefined>;
};

type ServerZeile = Pick<
  typeof server.$inferSelect,
  "serverId" | "agentVersion" | "architektur" | "wartungsfenster"
>;

/** The jobs of the server that have not ended, and when an update of the agent to `version` last ended */
const auftragsLage = (db: Db, betreiberId: string, serverId: string, version: string) => {
  const zeilen = db
    .select({
      aktion: auftraege.aktion,
      version: auftraege.version,
      zustand: auftraege.zustand,
      geaendertAm: auftraege.geaendertAm,
    })
    .from(auftraege)
    .where(and(eq(auftraege.betreiberId, betreiberId), eq(auftraege.serverId, serverId)))
    .all();
  const offen = zeilen.filter((z) => !ENDZUSTAENDE.has(z.zustand)).length;
  const versuche = zeilen
    .filter(
      (z) =>
        z.aktion === AGENT_UPDATE_AKTION && z.version === version && ENDZUSTAENDE.has(z.zustand),
    )
    .map((z) => z.geaendertAm);
  return versuche.length > 0 ? { offen, letzter: Math.max(...versuche) } : { offen };
};

/** What packages/planung needs to know of one server */
export const agentServer = (
  deps: Pick<AuftragDeps, "db" | "verbindungen">,
  betreiberId: string,
  s: ServerZeile,
  version: string,
): AgentServer => {
  const lage = auftragsLage(deps.db, betreiberId, s.serverId, version);
  return {
    agentVersion: s.agentVersion,
    architektur: s.architektur,
    wartungsfenster: wartungsfensterLesen(s.wartungsfenster),
    verbunden: deps.verbindungen.verbundenSeit(betreiberId, s.serverId) !== undefined,
    offeneAuftraege: lage.offen,
    ...(lage.letzter === undefined ? {} : { letzterVersuchAm: lage.letzter }),
  };
};

/** The operator's joined servers that are not revoked */
const beigetretene = (db: Db, betreiberId: string): ServerZeile[] =>
  db
    .select({
      serverId: server.serverId,
      agentVersion: server.agentVersion,
      architektur: server.architektur,
      wartungsfenster: server.wartungsfenster,
    })
    .from(server)
    .where(
      and(
        eq(server.betreiberId, betreiberId),
        isNotNull(server.beigetretenAm),
        isNull(server.gesperrtAm),
      ),
    )
    .all();

export type AgentRunde = { angelegt: string[] };

/** One round over every operator; returns the servers whose agent it started to update */
export const agentUpdatesPlanen = async (deps: AgentPlanungsDeps): Promise<AgentRunde> => {
  const stand = await deps.agentStand();
  if (!stand) return { angelegt: [] };
  const jetzt = deps.now();
  const angelegt: string[] = [];
  for (const { betreiberId } of deps.db
    .select({ betreiberId: betreiber.betreiberId })
    .from(betreiber)
    .all()) {
    for (const s of beigetretene(deps.db, betreiberId)) {
      const entscheid = agentUpdatePruefen(
        agentServer(deps, betreiberId, s, stand.version),
        stand.version,
        jetzt,
      );
      if (entscheid.art !== "jetzt") continue;
      const grund = `Update des Agenten von ${s.agentVersion} auf ${stand.version}`;
      const r = auftragAnlegen(
        deps,
        { betreiberId, akteur: "system", jetzt, grund },
        {
          serverId: s.serverId,
          installationId: null,
          aktion: AGENT_UPDATE_AKTION,
          argumente: { version: stand.version },
          manifest: stand.summen,
          signatur: stand.signatur,
        },
      );
      if (r.ok) angelegt.push(s.serverId);
      else
        deps.log(
          JSON.stringify({
            msg: "agent update not made",
            serverId: s.serverId,
            grund: r.grund,
            detail: r.detail,
          }),
        );
    }
  }
  return { angelegt };
};

/** Every minute, from now on */
export const agentUpdateSchleife = (deps: AgentPlanungsDeps, planen: Planer): void => {
  planen(() => {
    agentUpdatesPlanen(deps)
      .then((r) => {
        if (r.angelegt.length > 0) deps.log(JSON.stringify({ msg: "agent updates started", ...r }));
      })
      .catch((fehler) =>
        deps.log(JSON.stringify({ msg: "agent update planning failed", fehler: String(fehler) })),
      );
  }, AGENT_UPDATE_PLANUNG_MS);
};

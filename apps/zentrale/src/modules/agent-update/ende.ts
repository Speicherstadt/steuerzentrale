import { AGENT_UPDATE_AKTION } from "@steuerzentrale/manifest";
import { versionVergleichen } from "@steuerzentrale/planung";
import {
  type AuftragZustand,
  ENDZUSTAENDE,
  type NachrichtVomAgenten,
} from "@steuerzentrale/protokoll";
import type { Schreiber } from "../audit/index.ts";
import type { Auftrag } from "../auftraege/lesen.ts";

/*
 * What the Zentrale writes about an update of an agent (BAULISTE.md Z-504; docs/plan.md, "Update
 * des Agenten"), each as an event of the server within the transaction that changes the row:
 * - the job ends without success (refused, as for a wrong signature or checksum, failed, or
 *   cancelled): `agent_update_gescheitert`, the agent kept its binary;
 * - a successful job only says the new binary is in place; whether it runs shows the next `hallo`:
 *   a newer version than before is `agent_aktualisiert`, an older one `agent_zurueckgekehrt` (the
 *   new agent did not reach the Zentrale in time and the old one came back, or a person put it back).
 */

export const AGENT_ARTEN = {
  gescheitert: "agent_update_gescheitert",
  aktualisiert: "agent_aktualisiert",
  zurueckgekehrt: "agent_zurueckgekehrt",
} as const;

type Ergebnis = Extract<NachrichtVomAgenten, { typ: "ergebnis" }>["ergebnis"];

/** At the end of a job: an update of the agent that did not succeed becomes an event */
export const agentUpdateFortschreiben = (
  w: Schreiber,
  a: Pick<Auftrag, "betreiberId" | "auftragId" | "serverId" | "aktion" | "version">,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
  jetzt: number,
): void => {
  if (a.aktion !== AGENT_UPDATE_AKTION || !ENDZUSTAENDE.has(zustand)) return;
  if (zustand === "erfolgreich") return;
  const grund = ergebnis && !ergebnis.ok ? ergebnis.fehler : `Auftrag ${zustand}`;
  w.einfuegen("ereignisse", {
    betreiberId: a.betreiberId,
    ereignisId: `agent-update-${a.auftragId}`,
    zeitpunkt: jetzt,
    art: AGENT_ARTEN.gescheitert,
    schwere: "fehler",
    ziel: `server:${a.serverId}`,
    text: `Update des Agenten auf ${a.version} gescheitert, der Agent bleibt: ${grund}`,
  });
};

/** At `hallo`: a version other than the one the server had before becomes an event */
export const agentVersionFortschreiben = (
  w: Schreiber,
  s: { betreiberId: string; serverId: string; agentVersion: string | null },
  neu: string,
  jetzt: number,
): void => {
  const alt = s.agentVersion;
  if (alt === null || alt === neu) return;
  const hoeher = versionVergleichen(neu, alt) > 0;
  w.einfuegen("ereignisse", {
    betreiberId: s.betreiberId,
    ereignisId: `agent-version-${s.serverId}-${jetzt}`,
    zeitpunkt: jetzt,
    art: hoeher ? AGENT_ARTEN.aktualisiert : AGENT_ARTEN.zurueckgekehrt,
    schwere: hoeher ? "info" : "fehler",
    ziel: `server:${s.serverId}`,
    text: hoeher ? `Agent von ${alt} auf ${neu}` : `Agent zurück von ${alt} auf ${neu}`,
  });
};

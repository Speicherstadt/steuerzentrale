import { AGENT_UPDATE_AKTION } from "@steuerzentrale/manifest";
import { versionVergleichen } from "@steuerzentrale/planung";
import {
  type AuftragZustand,
  ENDZUSTAENDE,
  type NachrichtVomAgenten,
} from "@steuerzentrale/protokoll";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, ereignisse } from "../../db/schema.ts";
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
 *   A new agent that never said `hallo` left the server's version as it was: the old agent's `hallo`
 *   after the server's last update of the agent succeeded to a higher version is the same event,
 *   written once for that job.
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

/**
 * At `hallo` with the version the server had: the server's last update of the agent, if it put a
 * higher version in place and no version was reported since (its check put the old one back)
 */
export const rueckkehrOhneHallo = (
  db: Db,
  s: { betreiberId: string; serverId: string },
  neu: string,
): { auftragId: string; version: string } | undefined => {
  const letzter = db
    .select({
      auftragId: auftraege.auftragId,
      version: auftraege.version,
      zustand: auftraege.zustand,
      geaendertAm: auftraege.geaendertAm,
    })
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, s.betreiberId),
        eq(auftraege.serverId, s.serverId),
        eq(auftraege.aktion, AGENT_UPDATE_AKTION),
      ),
    )
    .orderBy(desc(auftraege.geaendertAm))
    .limit(1)
    .get();
  if (letzter?.zustand !== "erfolgreich") return undefined;
  if (versionVergleichen(letzter.version, neu) <= 0) return undefined;
  // a version reported since the job ended (the new agent's, or this return) already tells
  const gemeldet = db
    .select({ ereignisId: ereignisse.ereignisId })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, s.betreiberId),
        eq(ereignisse.ziel, `server:${s.serverId}`),
        inArray(ereignisse.art, [AGENT_ARTEN.aktualisiert, AGENT_ARTEN.zurueckgekehrt]),
        gte(ereignisse.zeitpunkt, letzter.geaendertAm),
      ),
    )
    .get();
  return gemeldet ? undefined : { auftragId: letzter.auftragId, version: letzter.version };
};

/** The event of a return to the old agent after the update `r.auftragId` */
export const rueckkehrFortschreiben = (
  w: Schreiber,
  s: { betreiberId: string; serverId: string },
  r: { auftragId: string; version: string },
  neu: string,
  jetzt: number,
): void => {
  w.einfuegen("ereignisse", {
    betreiberId: s.betreiberId,
    ereignisId: `agent-zurueck-${r.auftragId}`,
    zeitpunkt: jetzt,
    art: AGENT_ARTEN.zurueckgekehrt,
    schwere: "fehler",
    ziel: `server:${s.serverId}`,
    text: `Agent zurück von ${r.version} auf ${neu}: der neue meldete sich nicht`,
  });
};

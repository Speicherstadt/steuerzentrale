import { createHash } from "node:crypto";
import type { NachrichtVomAgenten } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { ereignisse } from "../../db/schema.ts";
import { faktenAnfuegen, schreiben } from "../audit/index.ts";
import type { Server } from "../server/index.ts";

/*
 * What an agent reports on its own (BAULISTE.md Z-304): its facts, kept as measurements (the newest
 * at the server, the history 30 days), and every SSH login, which becomes an event through the
 * audit log (docs/plan.md, "Notzugang").
 */

type Fakten = Extract<NachrichtVomAgenten, { typ: "fakten" }>;
type SshAnmeldung = Extract<NachrichtVomAgenten, { typ: "ssh_anmeldung" }>;

export const SSH_ART = "ssh_anmeldung";

/** Stores the facts at the Zentrale's time; the agent's own time stays in the message */
export const faktenSpeichern = (
  schreibDb: SchreibDb,
  server: Server,
  n: Fakten,
  jetzt: number,
): void =>
  faktenAnfuegen(schreibDb, {
    betreiberId: server.betreiberId,
    serverId: server.serverId,
    zeitpunkt: jetzt,
    daten: JSON.stringify(n),
  });

/**
 * One id per login, so the same login reported twice (the agent stopped between sending and
 * keeping its cursor) stays one event
 */
const ereignisId = (serverId: string, n: SshAnmeldung) =>
  `ssh-${createHash("sha256")
    .update(JSON.stringify([serverId, n.zeit, n.nutzer, n.von, n.methode]))
    .digest("hex")
    .slice(0, 32)}`;

/**
 * Writes the event of an SSH login at the time it happened, never later than now (the agent's
 * clock may be ahead), with severity `warn`: SSH is the emergency access, each login stands out
 */
export const sshAnmeldungSchreiben = (
  db: Db,
  schreibDb: SchreibDb,
  server: Server,
  n: SshAnmeldung,
  jetzt: number,
): void => {
  const id = ereignisId(server.serverId, n);
  const da = db
    .select({ id: ereignisse.ereignisId })
    .from(ereignisse)
    .where(and(eq(ereignisse.betreiberId, server.betreiberId), eq(ereignisse.ereignisId, id)))
    .get();
  if (da) return;
  const kontext = {
    betreiberId: server.betreiberId,
    akteur: `server:${server.serverId}`,
    jetzt,
    grund: "SSH-Anmeldung aus journald",
  };
  schreiben(schreibDb, kontext, "ereignis.ssh-anmeldung", (s) =>
    s.einfuegen("ereignisse", {
      betreiberId: server.betreiberId,
      ereignisId: id,
      zeitpunkt: Math.min(n.zeit, jetzt),
      art: SSH_ART,
      schwere: "warn",
      ziel: `server:${server.serverId}`,
      text: `SSH-Anmeldung auf ${server.name}: ${n.nutzer} von ${n.von} (${n.methode})`,
    }),
  );
};

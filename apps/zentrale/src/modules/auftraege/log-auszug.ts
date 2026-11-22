import { AKTIONS_AUFTRAEGE } from "@steuerzentrale/manifest";
import type { NachrichtVomAgenten } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { logAuszuege } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import type { Server } from "../server/index.ts";
import { type Auftrag, auftragLesen } from "./lesen.ts";

/*
 * Log excerpts (BAULISTE.md Z-405; docs/plan.md, "Log-Auszug", "Log-Auszüge der Aufträge"): the
 * agent reads the installation's journal, replaces the values of its secrets and sends the lines
 * with the job's id. The Zentrale keeps them once per job, only for a log job of the reporting
 * server and its operator, in `log_auszuege`, which the retention run empties after 30 days; the
 * audit log records the excerpt without its lines (audit/tabellen.ts, `ausgelasseneSpalten`).
 */

export type LogAuszugNachricht = Extract<NachrichtVomAgenten, { typ: "log_auszug" }>;

/** The agent cuts each line to this already; the Zentrale holds it to the same */
export const ZEILE_MAX = 2000;

export type Angenommen = { ok: true } | { ok: false; grund: string };

const vorhanden = (db: Db, betreiberId: string, auftragId: string) =>
  db
    .select()
    .from(logAuszuege)
    .where(and(eq(logAuszuege.betreiberId, betreiberId), eq(logAuszuege.auszugId, auftragId)))
    .get();

export const logAuszugAnnehmen = (
  deps: { db: Db; schreibDb: SchreibDb },
  server: Pick<Server, "betreiberId" | "serverId">,
  n: LogAuszugNachricht,
  jetzt: number,
): Angenommen => {
  const { betreiberId, serverId } = server;
  const a = auftragLesen(deps.db, betreiberId, n.auftragId);
  if (!a || a.serverId !== serverId || a.aktion !== AKTIONS_AUFTRAEGE.log_auszug)
    return { ok: false, grund: "not a log job of this server" };
  if (vorhanden(deps.db, betreiberId, a.auftragId)) return { ok: false, grund: "already kept" };
  const kontext = { betreiberId, akteur: `server:${serverId}`, jetzt, grund: "Log-Auszug" };
  schreiben(deps.schreibDb, kontext, "auftrag.log_auszug", (w) =>
    w.einfuegen("logAuszuege", {
      betreiberId,
      auszugId: a.auftragId,
      auftragId: a.auftragId,
      zeitpunkt: jetzt,
      inhalt: JSON.stringify(n.zeilen.map((z) => z.slice(0, ZEILE_MAX))),
    }),
  );
  return { ok: true };
};

export type LogAuszug = {
  auftrag: Auftrag;
  /** null until the agent sent them */
  zeilen: string[] | null;
  zeitpunkt: number | null;
};

/** The log job of the installation with its lines, within one operator; else undefined */
export const logAuszugLesen = (
  db: Db,
  betreiberId: string,
  installationId: string,
  auftragId: string,
): LogAuszug | undefined => {
  const a = auftragLesen(db, betreiberId, auftragId);
  if (!a || a.installationId !== installationId || a.aktion !== AKTIONS_AUFTRAEGE.log_auszug)
    return undefined;
  const zeile = vorhanden(db, betreiberId, auftragId);
  return {
    auftrag: a,
    zeilen: zeile ? (JSON.parse(zeile.inhalt) as string[]) : null,
    zeitpunkt: zeile?.zeitpunkt ?? null,
  };
};

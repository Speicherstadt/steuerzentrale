import {
  Auftrag as AuftragNachricht,
  BEIM_AGENTEN,
  schreiben as nachrichtSchreiben,
  PROTOKOLL_VERSION,
} from "@steuerzentrale/protokoll";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import type { LogSink } from "../../log.ts";
import { schreiben } from "../audit/index.ts";
import type { Verbindungen } from "../verbindung/verbindungen.ts";
import { type Auftrag, offeneAuftraege } from "./lesen.ts";

/*
 * Sending jobs to their agents (BAULISTE.md Z-305): a ready job goes out as soon as it is ready
 * and its server's agent is connected, and every job that is ready or with the agent goes out again
 * whenever the agent connects; the agent answers a job it knows from its own record (idempotent by
 * the id), so a job sent twice runs once.
 */

export type AuftragDeps = {
  db: Db;
  schreibDb: SchreibDb;
  verbindungen: Verbindungen;
  now: () => number;
  log: LogSink;
};

/** The `auftrag` message: the manifest's exact text and signature, which the agent checks */
export const auftragNachricht = (a: Auftrag): string =>
  nachrichtSchreiben(AuftragNachricht, {
    typ: "auftrag",
    protokoll: PROTOKOLL_VERSION,
    auftragId: a.auftragId,
    installationId: a.installationId,
    aktion: a.aktion,
    argumente: JSON.parse(a.argumente),
    manifest: a.manifest,
    signatur: a.signatur,
    zeitlimitS: a.zeitlimitS,
  });

/**
 * Sends each job that is ready or with the agent to its server's agent, if connected; a ready one
 * is `zugestellt` from then on. A waiting or finished job is not sent.
 */
export const zustellen = (deps: AuftragDeps, liste: readonly Auftrag[]): void => {
  for (const a of liste) {
    if (a.zustand !== "bereit" && !BEIM_AGENTEN.has(a.zustand)) continue;
    let text: string;
    try {
      text = auftragNachricht(a);
    } catch (fehler) {
      deps.log(
        JSON.stringify({ msg: "job not sent", auftragId: a.auftragId, fehler: String(fehler) }),
      );
      continue;
    }
    if (!deps.verbindungen.senden(a.betreiberId, a.serverId, text) || a.zustand !== "bereit")
      continue;
    const jetzt = deps.now();
    schreiben(
      deps.schreibDb,
      { betreiberId: a.betreiberId, akteur: "system", jetzt, grund: "Auftrag an den Agenten" },
      "auftrag.zugestellt",
      (w) =>
        w.aendern(
          "auftraege",
          { auftragId: a.auftragId },
          { zustand: "zugestellt", geaendertAm: jetzt },
        ),
    );
  }
};

/** Everything the server's agent should have, when it connects */
export const offeneZustellen = (deps: AuftragDeps, betreiberId: string, serverId: string): void =>
  zustellen(deps, offeneAuftraege(deps.db, betreiberId, serverId));

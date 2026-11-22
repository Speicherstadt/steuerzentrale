import { EINRICHTUNG_AKTIONEN, type Einrichtung, manifestPruefen } from "@steuerzentrale/manifest";
import { sperrzeitAm } from "@steuerzentrale/planung";
import {
  Auftrag as AuftragNachricht,
  BEIM_AGENTEN,
  schreiben as nachrichtSchreiben,
  PROTOKOLL_VERSION,
} from "@steuerzentrale/protokoll";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import type { LogSink } from "../../log.ts";
import { schreiben } from "../audit/index.ts";
import { einrichtungFuer } from "../installationen/einrichtung.ts";
import { konfigurationFuer } from "../installationen/konfiguration.ts";
import type { Verbindungen } from "../verbindung/verbindungen.ts";
import { type Auftrag, offeneAuftraege } from "./lesen.ts";

/*
 * Sending jobs to their agents (BAULISTE.md Z-305): a ready job goes out as soon as it is ready
 * and its server's agent is connected, and every job that is ready or with the agent goes out again
 * whenever the agent connects; the agent answers a job it knows from its own record (idempotent by
 * the id), so a job sent twice runs once. A setup job (`installation_einrichten`, Z-402) gets the
 * installation's data only here, with its secrets decrypted from the installation's row: the job's
 * row and the audit log never hold them. A job `installation_konfigurieren` (Z-404) gets the values
 * it asked for, from their own row (modules/installationen/konfiguration.ts).
 */

export type AuftragDeps = {
  db: Db;
  schreibDb: SchreibDb;
  verbindungen: Verbindungen;
  now: () => number;
  log: LogSink;
  /** For the secrets of an installation, decrypted when its setup job is sent */
  schluessel: Schluesselbund;
};

/** The `auftrag` message: the manifest's exact text and signature, which the agent checks */
export const auftragNachricht = (a: Auftrag, einrichtung?: Einrichtung): string =>
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
    ...(einrichtung ? { einrichtung } : {}),
  });

/** The installation's data for a setup job, or undefined for a job without */
const einrichtungVon = (deps: AuftragDeps, a: Auftrag) => {
  if (a.aktion === EINRICHTUNG_AKTIONEN.einrichten)
    return einrichtungFuer(deps, a.betreiberId, a.installationId);
  if (a.aktion === EINRICHTUNG_AKTIONEN.konfigurieren)
    return konfigurationFuer(deps, a.betreiberId, a);
  return undefined;
};

/** The message of a job; for a setup job with the installation's data, or why there is none */
const nachrichtFuer = (deps: AuftragDeps, a: Auftrag): string => {
  const einrichtung = einrichtungVon(deps, a);
  if (!einrichtung) return auftragNachricht(a);
  if (!einrichtung.ok) throw new Error(einrichtung.grund);
  return auftragNachricht(a, einrichtung.einrichtung);
};

/**
 * A job `installation_konfigurieren` the agent may not have yet, in a freeze window of its
 * manifest: it restarts the app, so it waits for a connection outside the window (docs/plan.md,
 * "Neu konfigurieren"); one the agent acknowledged it knows from its own record
 */
const inSperrzeit = (a: Auftrag, jetzt: number): boolean => {
  if (a.aktion !== EINRICHTUNG_AKTIONEN.konfigurieren) return false;
  if (a.zustand !== "bereit" && a.zustand !== "zugestellt") return false;
  const m = manifestPruefen(a.manifest);
  return !m.ok || sperrzeitAm(m.manifest.sperrzeiten, jetzt) !== undefined;
};

/**
 * Sends each job that is ready or with the agent to its server's agent, if connected; a ready one
 * is `zugestellt` from then on. A waiting or finished job is not sent, nor one that would restart
 * an app in its freeze window.
 */
export const zustellen = (deps: AuftragDeps, liste: readonly Auftrag[]): void => {
  for (const a of liste) {
    if (a.zustand !== "bereit" && !BEIM_AGENTEN.has(a.zustand)) continue;
    if (inSperrzeit(a, deps.now())) continue;
    let text: string;
    try {
      text = nachrichtFuer(deps, a);
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

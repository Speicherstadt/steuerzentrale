import type { OeffentlicherSchluessel, PforteAuftrag, Zweck } from "@steuerzentrale/manifest";
import type { NachrichtVonDerZentrale } from "@steuerzentrale/protokoll";
import type { Aktion } from "../aktionen/auftrag.ts";
import type { Backup } from "../backup/auftrag.ts";
import type { Einrichten, Entfernen, Konfigurieren } from "../einrichtung/typen.ts";
import type { PruefRestore } from "../pruef-restore/auftrag.ts";
import type { Update } from "../update/auftrag.ts";
import type { Wiederherstellen } from "../wiederherstellen/auftrag.ts";

/*
 * What a checked job runs (pruefen.ts), by its kind: a command of a manifest, or one of the jobs
 * built into the Steuerzentrale, each with its time limit and whether it runs again after a
 * restart of the agent (auftraege.ts). Types only.
 */

export type AuftragNachricht = Extract<NachrichtVonDerZentrale, { typ: "auftrag" }>;

/** The manifest key as install.sh left it, and whether the agent runs in test mode */
export type Vertrauen = { schluessel: OeffentlicherSchluessel; zweck: Zweck };

/** What runs: the argv of a command in a container of an installation, within a time limit */
export type Plan = {
  art: "befehl";
  aktion: string;
  installationId: string;
  container: string;
  argv: string[];
  zeitlimitMs: number;
  /** The manifest allows running it again after a restart of the agent */
  idempotent: boolean;
};

/** What a job of the Pforte does: set or remove a route through the admin API */
export type PfortePlan = {
  art: "pforte";
  aktion: string;
  auftrag: PforteAuftrag;
  zeitlimitMs: number;
  /** Setting a route replaces it, removing a missing one changes nothing: run again after a restart */
  idempotent: true;
};

/** What a setup job does: set up, reconfigure or tear down an installation (src/einrichtung) */
export type EinrichtungPlan = {
  art: "einrichtung";
  aktion: string;
  auftrag: Einrichten | Konfigurieren | Entfernen;
  zeitlimitMs: number;
  /**
   * Setting up and tearing down run again after a restart: the record of installations
   * (src/einrichtung/gedaechtnis.ts) tells a finished setup, and a half one is torn down before it
   * is set up anew. Reconfiguring does not: it restarts the app, and after a restart of the agent
   * that may be later than the Zentrale allowed (a freeze window); the Zentrale sends it anew
   */
  idempotent: boolean;
};

/** What an action of an installation does: restart it or read its log (src/aktionen) */
export type AktionPlan = {
  art: "aktion";
  aktion: string;
  auftrag: Aktion;
  zeitlimitMs: number;
  /**
   * A log excerpt only reads and runs again after a restart of the agent; a restart does not: after
   * a restart of the agent it may come later than the Zentrale allowed (a freeze window)
   */
  idempotent: boolean;
};

/** What a backup job does: set up the installation's backup, or back it up now (src/backup) */
export type BackupPlan = {
  art: "backup";
  aktion: string;
  auftrag: Backup;
  zeitlimitMs: number;
  /**
   * Setting up writes the same files again and creates no second repository; backing up now makes
   * one more snapshot of each part: both run again after a restart of the agent
   */
  idempotent: true;
};

/** What a Prüf-Restore does: a copy of the installation from its backup, then gone (src/pruef-restore) */
export type PruefRestorePlan = {
  art: "pruef_restore";
  aktion: string;
  auftrag: PruefRestore;
  zeitlimitMs: number;
  /**
   * The copy left by a stop of the agent is torn down when it starts again (resteAbbauen), and the
   * original is only read: a Prüf-Restore runs again after a restart
   */
  idempotent: true;
};

/** What a restore does: the installation's data back from a run of its backup (src/wiederherstellen) */
export type WiederherstellenPlan = {
  art: "wiederherstellen";
  aktion: string;
  auftrag: Wiederherstellen;
  zeitlimitMs: number;
  /**
   * Not run again after a restart of the agent: it stops the app and replaces its data, which
   * after a restart may come at a time nobody chose; the Zentrale sends it anew
   */
  idempotent: false;
};

/** What an update does: the installation on a new version, or back on the old one (src/update) */
export type UpdatePlan = {
  art: "update";
  aktion: string;
  auftrag: Update;
  zeitlimitMs: number;
  /**
   * Not run again after a restart of the agent: it stops the app, and a rollback replaces its data;
   * after a restart that may come at a time nobody chose (a freeze window). The Zentrale sends it
   * anew
   */
  idempotent: false;
};

export type JederPlan =
  | Plan
  | PfortePlan
  | EinrichtungPlan
  | AktionPlan
  | BackupPlan
  | PruefRestorePlan
  | WiederherstellenPlan
  | UpdatePlan;

export type Geprueft = { ok: true; plan: JederPlan } | { ok: false; grund: string };

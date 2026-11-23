import {
  AKTION_ZEITLIMIT_S,
  aktionsAuftragPruefen,
  BACKUP_AKTIONEN,
  BACKUP_EINRICHTEN_ZEITLIMIT_S,
  BACKUP_ZEITLIMIT_S,
  backupAuftragPruefen,
  befehlFuellen,
  befehlZurAktion,
  EINRICHTUNG_ZEITLIMIT_S,
  einrichtungAuftragPruefen,
  geheimeEinstellungen,
  INSTALLATIONS_NAME,
  istAktionsAuftrag,
  istBackupAktion,
  istEinrichtungAktion,
  istPforteAktion,
  type Manifest,
  type OeffentlicherSchluessel,
  PFORTE_ZEITLIMIT_S,
  type PforteAuftrag,
  PRUEF_RESTORE_AKTION,
  PRUEF_RESTORE_KOPIE,
  PRUEF_RESTORE_ZEITLIMIT_S,
  pforteAuftragPruefen,
  pruefRestoreAuftragPruefen,
  restoreTeile,
  STANDARD_ZEITLIMIT_S,
  schluesselVertrauen,
  signiertesManifestLaden,
  WIEDERHERSTELLEN_AKTION,
  WIEDERHERSTELLEN_ZEITLIMIT_S,
  wiederherstellenAuftragPruefen,
  type Zweck,
} from "@steuerzentrale/manifest";
import type { NachrichtVonDerZentrale } from "@steuerzentrale/protokoll";
import type { Aktion } from "../aktionen/auftrag.ts";
import type { Backup } from "../backup/auftrag.ts";
import type { Einrichten, Entfernen, Konfigurieren, Schritt } from "../einrichtung/typen.ts";
import type { PruefRestore } from "../pruef-restore/auftrag.ts";
import type { Wiederherstellen } from "../wiederherstellen/auftrag.ts";
import { pruefZiel } from "../zustand/ziel.ts";

/*
 * What the agent checks before it runs anything a job asks (BAULISTE.md Z-305; docs/plan.md, "Was
 * der Agent ausführt"), in this order: the key it trusts (never the public test key outside test
 * mode), the manifest's minisign signature over its exact bytes, the action as a command of that
 * manifest, the arguments against the command's declaration. Only then is there an argv to run,
 * taken from the signed manifest. A job of the Pforte (Z-401) passes the same key and signature
 * checks, then its fixed shape (packages/manifest, pforte/auftraege.ts) instead of a command; its
 * route is rendered from the signed manifest. A setup job (Z-402) likewise, with
 * einrichtungAuftragPruefen: its units are rendered from the signed manifest, and the commands of
 * `schritte.einrichten` filled from it; reconfiguring (Z-404) alike, without them. A restart or a
 * log excerpt (Z-405) passes aktionsAuftragPruefen: refused unless the manifest offers it. A
 * backup job (Z-601) passes backupAuftragPruefen; only `installation_backup_einrichten` may carry
 * the field `backup`, with the installation's repository, S3 access and restic password. A
 * Prüf-Restore (Z-602) passes pruefRestoreAuftragPruefen: its copy's units are rendered from the
 * signed manifest like a setup's, under the copy's name and ports. A restore (Z-603) passes
 * wiederherstellenAuftragPruefen: the parts from the signed manifest, the snapshots from the job.
 * Pure, no I/O.
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

export type JederPlan =
  | Plan
  | PfortePlan
  | EinrichtungPlan
  | AktionPlan
  | BackupPlan
  | PruefRestorePlan
  | WiederherstellenPlan;

export type Geprueft = { ok: true; plan: JederPlan } | { ok: false; grund: string };

const pfortePlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = pforteAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  return {
    ok: true,
    plan: {
      art: "pforte",
      aktion: n.aktion,
      auftrag: geprueft.auftrag,
      zeitlimitMs: Math.min(n.zeitlimitS, PFORTE_ZEITLIMIT_S) * 1000,
      idempotent: true,
    },
  };
};

const aktionPlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = aktionsAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  const { art, name } = geprueft.auftrag;
  return {
    ok: true,
    plan: {
      art: "aktion",
      aktion: n.aktion,
      auftrag: {
        art,
        name,
        manifest: { id: m.id, version: m.version, geheim: geheimeEinstellungen(m) },
      },
      zeitlimitMs: Math.min(n.zeitlimitS, AKTION_ZEITLIMIT_S) * 1000,
      idempotent: art === "log_auszug",
    },
  };
};

const backupPlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = backupAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  const a = geprueft.auftrag;
  const auftrag: Backup =
    a.art === "jetzt"
      ? a
      : { ...a, manifest: { id: m.id, version: m.version, geheim: geheimeEinstellungen(m) } };
  // backing up now waits for the run, which the service's limit ends a little later
  const grenze = a.art === "jetzt" ? BACKUP_ZEITLIMIT_S + 120 : BACKUP_EINRICHTEN_ZEITLIMIT_S;
  return {
    ok: true,
    plan: {
      art: "backup",
      aktion: n.aktion,
      auftrag,
      zeitlimitMs: Math.min(n.zeitlimitS, grenze) * 1000,
      idempotent: true,
    },
  };
};

const pruefRestorePlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = pruefRestoreAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  const a = geprueft.auftrag;
  // pruefRestoreAuftragPruefen refuses one without it already
  if (n.einrichtung === undefined) return { ok: false, grund: "einrichtung is missing" };
  // the parts as they are played back into the copy, from the same signed manifest
  const teile = restoreTeile(m, a.kopie);
  if (!teile.ok) return teile;
  const kopie: Einrichten = {
    art: "einrichten",
    name: a.kopie,
    quadlets: a.quadlets,
    units: a.units,
    schritte: [],
    // the health check on the copy's own ports (Z-403)
    ziel: pruefZiel(m, n.einrichtung.installation),
    geheim: geheimeEinstellungen(m),
  };
  return {
    ok: true,
    plan: {
      art: "pruef_restore",
      aktion: n.aktion,
      auftrag: {
        art: "pruef_restore",
        original: a.original,
        kopie,
        teile: teile.teile,
        netz: teile.netz,
        manifest: { id: m.id, version: m.version, geheim: kopie.geheim },
      },
      zeitlimitMs: Math.min(n.zeitlimitS, PRUEF_RESTORE_ZEITLIMIT_S) * 1000,
      idempotent: true,
    },
  };
};

const wiederherstellenPlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = wiederherstellenAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  const { name, teile, netz, snapshots } = geprueft.auftrag;
  const manifest = { id: m.id, version: m.version, geheim: geheimeEinstellungen(m) };
  return {
    ok: true,
    plan: {
      art: "wiederherstellen",
      aktion: n.aktion,
      auftrag: { art: "wiederherstellen", name, teile, netz, snapshots, manifest },
      zeitlimitMs: Math.min(n.zeitlimitS, WIEDERHERSTELLEN_ZEITLIMIT_S) * 1000,
      idempotent: false,
    },
  };
};

/** A command of `schritte.einrichten` as it runs: no arguments, its own time limit */
const schrittFuellen = (m: Manifest, name: string): Schritt | string => {
  const befehl = befehlZurAktion(m, name);
  if (!befehl) return `schritte.einrichten: ${name} is not a command of the manifest`;
  const gefuellt = befehlFuellen(befehl, {});
  if (!gefuellt.ok) return `schritte.einrichten: ${name}: ${gefuellt.grund}`;
  return {
    name,
    container: befehl.container,
    argv: gefuellt.argv,
    zeitlimitMs: (befehl.zeitlimit_s ?? STANDARD_ZEITLIMIT_S) * 1000,
  };
};

const einrichtungsAuftrag = (m: Manifest, n: AuftragNachricht) => {
  // the agent tears down what is left of a test restore's copy by its name (src/pruef-restore)
  if (n.installationId !== null && PRUEF_RESTORE_KOPIE.test(n.installationId))
    return { ok: false as const, grund: `${n.installationId} names the copy of a test restore` };
  const geprueft = einrichtungAuftragPruefen(m, n);
  if (!geprueft.ok) return geprueft;
  const a = geprueft.auftrag;
  if (a.art === "entfernen") return { ok: true as const, auftrag: a };
  // einrichtungAuftragPruefen refuses a setup without it already
  if (n.einrichtung === undefined)
    return { ok: false as const, grund: "setting up needs the installation data (einrichtung)" };
  // the health check's target from the signed manifest and the ports the job assigned (Z-403)
  const ziel = pruefZiel(m, n.einrichtung.installation);
  // the names a log excerpt replaces (Z-405), kept in the record with the installation
  const geheim = geheimeEinstellungen(m);
  if (a.art === "konfigurieren") return { ok: true as const, auftrag: { ...a, ziel, geheim } };
  const schritte: Schritt[] = [];
  for (const name of a.schritte) {
    const s = schrittFuellen(m, name);
    if (typeof s === "string") return { ok: false as const, grund: s };
    schritte.push(s);
  }
  return { ok: true as const, auftrag: { ...a, schritte, ziel, geheim } };
};

const einrichtungPlan = (m: Manifest, n: AuftragNachricht): Geprueft => {
  const geprueft = einrichtungsAuftrag(m, n);
  if (!geprueft.ok) return geprueft;
  return {
    ok: true,
    plan: {
      art: "einrichtung",
      aktion: n.aktion,
      auftrag: geprueft.auftrag,
      zeitlimitMs: Math.min(n.zeitlimitS, EINRICHTUNG_ZEITLIMIT_S) * 1000,
      idempotent: geprueft.auftrag.art !== "konfigurieren",
    },
  };
};

export const auftragPruefen = (n: AuftragNachricht, vertrauen: Vertrauen): Geprueft => {
  const vertraut = schluesselVertrauen(vertrauen.schluessel, vertrauen.zweck);
  if (!vertraut.ok) return vertraut;
  const geladen = signiertesManifestLaden(
    new TextEncoder().encode(n.manifest),
    n.signatur,
    vertrauen.schluessel,
  );
  if (!geladen.ok) return { ok: false, grund: geladen.fehler.join("; ") };
  // an installation's repository, S3 access and password belong to setting up its backup only
  if (n.backup !== undefined && n.aktion !== BACKUP_AKTIONEN.einrichten)
    return { ok: false, grund: "only installation_backup_einrichten carries backup data (backup)" };
  if (istBackupAktion(n.aktion)) return backupPlan(geladen.manifest, n);
  if (n.aktion === PRUEF_RESTORE_AKTION) return pruefRestorePlan(geladen.manifest, n);
  if (n.aktion === WIEDERHERSTELLEN_AKTION) return wiederherstellenPlan(geladen.manifest, n);
  if (istEinrichtungAktion(n.aktion)) return einrichtungPlan(geladen.manifest, n);
  // the installation's data and its secrets belong to a setup job (and a copy's), and only there
  if (n.einrichtung !== undefined)
    return { ok: false, grund: "only a setup job carries installation data (einrichtung)" };
  if (istPforteAktion(n.aktion)) return pfortePlan(geladen.manifest, n);
  if (istAktionsAuftrag(n.aktion)) return aktionPlan(geladen.manifest, n);
  const befehl = befehlZurAktion(geladen.manifest, n.aktion);
  if (!befehl) return { ok: false, grund: `${n.aktion} is not a command of the manifest` };
  const gefuellt = befehlFuellen(befehl, n.argumente);
  if (!gefuellt.ok) return gefuellt;
  if (n.installationId === null || !INSTALLATIONS_NAME.test(n.installationId))
    return { ok: false, grund: "a command runs in a container of a named installation" };
  // the Zentrale may shorten the manifest's limit, never lengthen it
  const zeitlimitS = Math.min(n.zeitlimitS, befehl.zeitlimit_s ?? STANDARD_ZEITLIMIT_S);
  return {
    ok: true,
    plan: {
      art: "befehl",
      aktion: n.aktion,
      installationId: n.installationId,
      container: befehl.container,
      argv: gefuellt.argv,
      zeitlimitMs: zeitlimitS * 1000,
      idempotent: befehl.idempotent,
    },
  };
};

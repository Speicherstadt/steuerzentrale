import { createHash, randomUUID } from "node:crypto";
import {
  ABWICKLUNG_AKTIONEN,
  AGENT_APP,
  AGENT_UPDATE_AKTION,
  AGENT_UPDATE_ZEITLIMIT_S,
  AKTION_ZEITLIMIT_S,
  ARCHIV_ZEITLIMIT_S,
  type ArgumentWert,
  abwicklungAuftragPruefen,
  agentUpdateAuftragPruefen,
  aktionsAuftragPruefen,
  BACKUP_AKTIONEN,
  BACKUP_EINRICHTEN_ZEITLIMIT_S,
  BACKUP_ZEITLIMIT_S,
  type BackupZugang,
  backupAuftragPruefen,
  befehlFuellen,
  befehlZurAktion,
  EINRICHTUNG_ZEITLIMIT_S,
  type Einrichtung,
  einrichtungAuftragPruefen,
  INSTALLATIONS_NAME,
  imBeobachtenErlaubt,
  istAbwicklungAktion,
  istAktionsAuftrag,
  istBackupAktion,
  istEinrichtungAktion,
  istPforteAktion,
  LOESCHEN_ZEITLIMIT_S,
  type Manifest,
  manifestPruefen,
  PFORTE_ZEITLIMIT_S,
  PRUEF_RESTORE_AKTION,
  PRUEF_RESTORE_ZEITLIMIT_S,
  pforteAuftragPruefen,
  pruefRestoreAuftragPruefen,
  restoreTeile,
  SERVER_NEUSTART_AKTION,
  SERVER_NEUSTART_APP,
  SERVER_NEUSTART_ZEITLIMIT_S,
  STANDARD_ZEITLIMIT_S,
  serverNeustartAuftragPruefen,
  UPDATE_AKTION,
  UPDATE_ZEITLIMIT_S,
  updateArgumente,
  updateAuftragPruefen,
  WIEDERHERSTELLEN_AKTION,
  WIEDERHERSTELLEN_ZEITLIMIT_S,
  wiederherstellenAuftragPruefen,
} from "@steuerzentrale/manifest";
import type { AuftragZustand } from "@steuerzentrale/protokoll";
import { type Kontext, type Schreiber, schreiben } from "../audit/index.ts";
import { nurBeobachtet, serverLesen } from "../server/index.ts";
import { startzustand, zyklusIn } from "./abhaengigkeiten.ts";
import { type Auftrag, auftragLesen, vorgaengerVon, zustaendeLesen } from "./lesen.ts";
import { type AuftragDeps, auftragNachricht, zustellen } from "./zustellen.ts";

/*
 * Making a job (BAULISTE.md Z-305), for now only from within the Zentrale (installing, updating and
 * the interface come with their items): the action must be a command of the manifest and the
 * arguments must fit it, checked here already so a wrong job never waits; the agent checks all of
 * it again, and the signature, before it runs anything. A job may wait for jobs of its operator on
 * any server; it is ready once they all succeeded and then goes to its agent at once. A job of the
 * Pforte (Z-401) is no command of the manifest but one of the Steuerzentrale's own, with a fixed
 * shape (packages/manifest, pforte/auftraege.ts), and so are the setup jobs of an installation
 * (Z-402, einrichtung/auftraege.ts), checked with the installation's data, which the row does not
 * keep: it is taken from the installation when the job is sent (zustellen.ts). Restart and log
 * excerpt of an installation (Z-405, aktionen.ts) are built in too, without arguments, and only for
 * a manifest that offers them, and so are the backup jobs (Z-601, backup.ts), only for a manifest
 * with parts to back up; setting up backups is checked with its field `backup`, which the row does
 * not keep either. The test restore (Z-602, backup/pruef-restore.ts) is checked with the copy's data
 * in `einrichtung`, like a setup. A restore (Z-603, backup/wiederherstellen.ts) names a snapshot per
 * part that is played back and nothing else. An update (Z-503, einrichtung/update.ts) is checked with
 * the installation's data for the new version in `einrichtung`, like a setup; the snapshots of the
 * backup just before it are not known when it is made (modules/updates, ende.ts sets them), so it
 * is checked with a stand-in for each until then. The update of the agent itself (Z-504,
 * agent-update.ts) carries SHA256SUMS and its signature in the place of a manifest; its row names
 * the agent as its app and the new version. The reboot of a server (Z-701, server-neustart.ts) carries
 * no manifest and the boot it is meant for; its row names the operating system as its app.
 */

export type NeuerAuftrag = {
  serverId: string;
  /** The installation (its name, as in its units) whose container runs the command */
  installationId: string | null;
  /** The name of a command under `befehle` in the manifest, or a job of the Pforte */
  aktion: string;
  argumente: Record<string, ArgumentWert>;
  /** The manifest's exact text and its minisign signature (`manifest.yml.minisig`) */
  manifest: string;
  signatur: string;
  wartetAuf?: readonly string[];
  /** A caller's own id, so that making the same job again is refused instead of doubled */
  auftragId?: string;
  /** Only to check `installation_einrichten` and the test restore; not stored with the job */
  einrichtung?: Einrichtung;
  /** Only to check `installation_backup_einrichten` (Z-601); not stored with the job */
  backup?: BackupZugang;
};

export type AnlageFehler =
  | "server_unbekannt"
  | "server_gesperrt"
  | "nur_beobachten"
  | "manifest_ungueltig"
  | "aktion_unbekannt"
  | "argumente_ungueltig"
  | "installation_fehlt"
  | "vorgaenger_unbekannt"
  | "zyklus"
  | "auftrag_vorhanden"
  | "nachricht_ungueltig";

export type Angelegt =
  | { ok: true; auftrag: Auftrag }
  | { ok: false; grund: AnlageFehler; detail?: string };

type Geprueft =
  | { ok: true; manifest: Manifest; zeitlimitS: number }
  | { ok: false; grund: AnlageFehler; detail?: string };

type Fehler = { ok: false; grund: AnlageFehler; detail?: string };

/** A job checked and ready to be written, as its row */
export type Vorbereitet = { ok: true; zeile: Auftrag } | Fehler;

/** A job written in the same change, not yet visible to the read-only connection */
export type VorabAuftrag = Pick<Auftrag, "auftragId" | "zustand" | "wartetAuf">;

/** A snapshot ID that stands in for one the backup before an update has not made yet */
const STELLVERTRETER = "0".repeat(64);

/** An update's arguments, or with no snapshots yet a stand-in for each part played back */
const mitSnapshots = (m: Manifest, neu: NeuerAuftrag): Record<string, ArgumentWert> => {
  if (Object.keys(neu.argumente).length > 0 || neu.installationId === null) return neu.argumente;
  const teile = restoreTeile(m, neu.installationId);
  if (!teile.ok) return neu.argumente;
  const lauf = teile.teile.map((t) => ({ tag: t.tag, snapshot: STELLVERTRETER }));
  const a = updateArgumente(m, neu.installationId, lauf);
  return a.ok ? a.argumente : neu.argumente;
};

/** What the row keeps of a checked job: its app and version, and its time limit */
type Kennung =
  | { ok: true; app: string; version: string; zeitlimitS: number }
  | { ok: false; grund: AnlageFehler; detail?: string };

/** The update of the agent (Z-504): no manifest, a fixed shape; the agent checks the signature */
const agentUpdateKennung = (neu: NeuerAuftrag): Kennung => {
  const g = agentUpdateAuftragPruefen(neu);
  return g.ok
    ? { ok: true, app: AGENT_APP, version: g.auftrag.version, zeitlimitS: AGENT_UPDATE_ZEITLIMIT_S }
    : { ok: false, grund: "argumente_ungueltig", detail: g.grund };
};

/** The reboot of a server (Z-701): no manifest, a fixed shape with the boot it is meant for */
const neustartKennung = (neu: NeuerAuftrag): Kennung => {
  const g = serverNeustartAuftragPruefen(neu);
  return g.ok
    ? { ok: true, app: SERVER_NEUSTART_APP, version: "-", zeitlimitS: SERVER_NEUSTART_ZEITLIMIT_S }
    : { ok: false, grund: "argumente_ungueltig", detail: g.grund };
};

const kennung = (neu: NeuerAuftrag): Kennung => {
  if (neu.aktion === AGENT_UPDATE_AKTION) return agentUpdateKennung(neu);
  if (neu.aktion === SERVER_NEUSTART_AKTION) return neustartKennung(neu);
  const g = gegenManifest(neu);
  if (!g.ok) return g;
  return { ok: true, app: g.manifest.id, version: g.manifest.version, zeitlimitS: g.zeitlimitS };
};

/** The job against its manifest: a command it names, with arguments that fit */
const gegenManifest = (neu: NeuerAuftrag): Geprueft => {
  const geprueft = manifestPruefen(neu.manifest);
  if (!geprueft.ok)
    return { ok: false, grund: "manifest_ungueltig", detail: geprueft.fehler.join("; ") };
  if (istEinrichtungAktion(neu.aktion)) {
    const einrichtung = einrichtungAuftragPruefen(geprueft.manifest, neu);
    return einrichtung.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS: EINRICHTUNG_ZEITLIMIT_S }
      : { ok: false, grund: "argumente_ungueltig", detail: einrichtung.grund };
  }
  if (neu.aktion === PRUEF_RESTORE_AKTION) {
    const pruef = pruefRestoreAuftragPruefen(geprueft.manifest, neu);
    return pruef.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS: PRUEF_RESTORE_ZEITLIMIT_S }
      : { ok: false, grund: "argumente_ungueltig", detail: pruef.grund };
  }
  if (neu.aktion === WIEDERHERSTELLEN_AKTION) {
    const zurueck = wiederherstellenAuftragPruefen(geprueft.manifest, neu);
    return zurueck.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS: WIEDERHERSTELLEN_ZEITLIMIT_S }
      : { ok: false, grund: "argumente_ungueltig", detail: zurueck.grund };
  }
  if (neu.aktion === UPDATE_AKTION) {
    const update = updateAuftragPruefen(geprueft.manifest, {
      ...neu,
      argumente: mitSnapshots(geprueft.manifest, neu),
    });
    return update.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS: UPDATE_ZEITLIMIT_S }
      : { ok: false, grund: "argumente_ungueltig", detail: update.grund };
  }
  if (istPforteAktion(neu.aktion)) {
    const pforte = pforteAuftragPruefen(geprueft.manifest, neu);
    return pforte.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS: PFORTE_ZEITLIMIT_S }
      : { ok: false, grund: "argumente_ungueltig", detail: pforte.grund };
  }
  if (istBackupAktion(neu.aktion)) {
    const backup = backupAuftragPruefen(geprueft.manifest, neu);
    // a run gets the service's limit and two minutes to report (apps/agent, auftraege/pruefen.ts)
    const zeitlimitS =
      neu.aktion === BACKUP_AKTIONEN.einrichten
        ? BACKUP_EINRICHTEN_ZEITLIMIT_S
        : BACKUP_ZEITLIMIT_S + 120;
    return backup.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS }
      : { ok: false, grund: "argumente_ungueltig", detail: backup.grund };
  }
  if (istAbwicklungAktion(neu.aktion)) {
    const abwicklung = abwicklungAuftragPruefen(geprueft.manifest, neu);
    const zeitlimitS =
      neu.aktion === ABWICKLUNG_AKTIONEN.archiv ? ARCHIV_ZEITLIMIT_S + 120 : LOESCHEN_ZEITLIMIT_S;
    return abwicklung.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS }
      : { ok: false, grund: "argumente_ungueltig", detail: abwicklung.grund };
  }
  if (istAktionsAuftrag(neu.aktion)) {
    const aktion = aktionsAuftragPruefen(geprueft.manifest, neu);
    return aktion.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS: AKTION_ZEITLIMIT_S }
      : { ok: false, grund: "argumente_ungueltig", detail: aktion.grund };
  }
  const befehl = befehlZurAktion(geprueft.manifest, neu.aktion);
  if (!befehl) return { ok: false, grund: "aktion_unbekannt", detail: neu.aktion };
  const gefuellt = befehlFuellen(befehl, neu.argumente);
  if (!gefuellt.ok) return { ok: false, grund: "argumente_ungueltig", detail: gefuellt.grund };
  // a command runs in a container of an installation (docs/manifest.md, "Befehle")
  if (neu.installationId === null || !INSTALLATIONS_NAME.test(neu.installationId))
    return { ok: false, grund: "installation_fehlt" };
  return {
    ok: true,
    manifest: geprueft.manifest,
    zeitlimitS: befehl.zeitlimit_s ?? STANDARD_ZEITLIMIT_S,
  };
};

/**
 * Checks a job against its server, manifest and predecessors and returns its row, unwritten;
 * `vorab` are jobs of the same change that the read-only connection does not see yet
 */
export const auftragVorbereiten = (
  deps: AuftragDeps,
  kontext: Kontext,
  neu: NeuerAuftrag,
  vorab: readonly VorabAuftrag[] = [],
): Vorbereitet => {
  const { betreiberId, jetzt } = kontext;
  const server = serverLesen(deps.db, betreiberId, neu.serverId);
  if (!server) return { ok: false, grund: "server_unbekannt" };
  if (server.gesperrtAm !== null) return { ok: false, grund: "server_gesperrt" };
  // a server only observed takes no job that changes it, its agent's update aside (Z-1102)
  if (nurBeobachtet(server) && !imBeobachtenErlaubt(neu.aktion))
    return { ok: false, grund: "nur_beobachten" };
  const geprueft = kennung(neu);
  if (!geprueft.ok) return geprueft;
  const auftragId = neu.auftragId ?? randomUUID();
  const bekannt = (id: string) =>
    vorab.find((a) => a.auftragId === id) ?? auftragLesen(deps.db, betreiberId, id);
  if (bekannt(auftragId)) return { ok: false, grund: "auftrag_vorhanden" };
  const wartetAuf = [...new Set(neu.wartetAuf ?? [])];
  const vorgaenger = (id: string) => {
    const a = bekannt(id);
    return a ? vorgaengerVon(a) : [];
  };
  if (zyklusIn({ id: auftragId, wartetAuf }, vorgaenger)) return { ok: false, grund: "zyklus" };
  const zustaende = new Map<string, AuftragZustand>([
    ...zustaendeLesen(deps.db, betreiberId, wartetAuf),
    ...vorab.map((a) => [a.auftragId, a.zustand] as const),
  ]);
  const unbekannt = wartetAuf.filter((id) => !zustaende.has(id));
  if (unbekannt.length > 0)
    return { ok: false, grund: "vorgaenger_unbekannt", detail: unbekannt.join(", ") };
  const zeile: Auftrag = {
    betreiberId,
    auftragId,
    serverId: neu.serverId,
    installationId: neu.installationId,
    aktion: neu.aktion,
    app: geprueft.app,
    version: geprueft.version,
    manifestHash: createHash("sha256").update(neu.manifest, "utf8").digest("hex"),
    manifest: neu.manifest,
    signatur: neu.signatur,
    argumente: JSON.stringify(neu.argumente),
    zeitlimitS: geprueft.zeitlimitS,
    zustand: startzustand(wartetAuf.map((id) => zustaende.get(id) ?? "wartend")),
    wartetAuf: JSON.stringify(wartetAuf),
    fortschritt: null,
    fortschrittAm: null,
    ergebnis: null,
    angelegtVon: kontext.akteur,
    angelegtAm: jetzt,
    geaendertAm: jetzt,
  };
  // a job the protocol cannot carry (an id or a manifest too long) would stay ready for ever
  try {
    auftragNachricht(zeile, { einrichtung: neu.einrichtung, backup: neu.backup });
  } catch (fehler) {
    return { ok: false, grund: "nachricht_ungueltig", detail: String(fehler).slice(0, 500) };
  }
  return { ok: true, zeile };
};

/** Writes a prepared job within a change of the caller (`schreiben`); returns the stored row */
export const auftragEinfuegen = (w: Schreiber, zeile: Auftrag): Auftrag => {
  const { fortschritt: _f, fortschrittAm: _fa, ergebnis: _e, ...werte } = zeile;
  return w.einfuegen("auftraege", werte);
};

export const auftragAnlegen = (
  deps: AuftragDeps,
  kontext: Kontext,
  neu: NeuerAuftrag,
): Angelegt => {
  const vorbereitet = auftragVorbereiten(deps, kontext, neu);
  if (!vorbereitet.ok) return vorbereitet;
  const auftrag = schreiben(deps.schreibDb, kontext, "auftrag.anlegen", (w) =>
    auftragEinfuegen(w, vorbereitet.zeile),
  );
  zustellen(deps, [auftrag]);
  const { betreiberId } = kontext;
  return { ok: true, auftrag: auftragLesen(deps.db, betreiberId, auftrag.auftragId) ?? auftrag };
};

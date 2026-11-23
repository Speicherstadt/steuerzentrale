import { BACKUP_ZEITLIMIT_S, type BackupTeil } from "@steuerzentrale/manifest";
import type { Planer } from "../verbindung/verbinden.ts";
import type { BackupDatei, Lauf } from "./datei.ts";
import {
  anlegenArgv,
  forgetArgv,
  type Repo,
  resticGrund,
  snapshotAus,
  teilArgv,
  verwerfenArgv,
  zugangIni,
} from "./restic.ts";

/*
 * One run of the backup as the installation's user (BAULISTE.md Z-601; docs/plan.md, "Backup auf
 * dem Server"), what `steuerzentrale-agent sichern <installation>` does: each part of backup.json
 * with its own tag, then `forget` by the retention, but only when every part went through, so a
 * failing source never thins out the snapshots before it. A part that fails fails the run; the
 * others still run. A reason names the part and restic's exit code (restic.ts), never output of
 * restic or a command: either may hold data of the installation. restic is passed in, so the run
 * is tested without Podman.
 */

/** What restic reads beside its argv (restic.ts: descriptors 3 and 4) */
export type Geheim = { passwort: string; zugang: string };

/**
 * restic's argv and, for a dump or a command, the argv whose output goes to its standard input;
 * for playing a snapshot back (Z-602), the argv that reads restic's output instead (`ziel`)
 */
export type ResticAufruf = {
  argv: string[];
  quelle?: string[];
  ziel?: string[];
  /** For the archive after a contract (Z-604): restic's standard output into this file */
  datei?: string;
};

/**
 * restic's exit code and standard output (empty when a target reads it), and the exit code of the
 * source or the target, if any
 */
export type ResticAntwort = {
  code: number | null;
  aus: string;
  quelleCode?: number | null;
  zielCode?: number | null;
};

/** Runs restic, killed when the signal aborts; throws when it cannot start */
export type ResticLauf = (
  a: ResticAufruf,
  geheim: Geheim,
  signal: AbortSignal,
) => Promise<ResticAntwort>;

export type SichernDeps = {
  restic: ResticLauf;
  jetzt: () => number;
  /** The run's own ID */
  id: () => string;
  planen: Planer;
};

type TeilStand = Lauf["teile"][number];

/** The run stops five minutes before the service's limit, so it still writes its result */
export const LAUF_ZEITLIMIT_MS = (BACKUP_ZEITLIMIT_S - 300) * 1000;

const repo = (d: BackupDatei): Repo => ({ installation: d.installation, repository: d.repository });
const geheimVon = (d: BackupDatei): Geheim => ({
  passwort: d.passwort,
  zugang: zugangIni(d.zugang),
});

/** An AbortSignal that aborts after `ms` or with the one given; `abgelaufen` says which */
const frist = (deps: SichernDeps, ms: number | undefined, aussen: AbortSignal) => {
  const eigen = new AbortController();
  let abgelaufen = false;
  const aufheben =
    ms === undefined
      ? () => {}
      : deps.planen(() => {
          abgelaufen = true;
          eigen.abort();
        }, ms);
  return {
    signal: AbortSignal.any([aussen, eigen.signal]),
    abgelaufen: () => abgelaufen,
    aufheben,
  };
};

const fehlgeschlagen = (tag: string, fehler: string, snapshot?: string): TeilStand => ({
  tag,
  ok: false,
  fehler,
  ...(snapshot === undefined ? {} : { snapshot }),
});

const verwerfen = async (deps: SichernDeps, d: BackupDatei, snapshot: string, s: AbortSignal) => {
  try {
    await deps.restic({ argv: verwerfenArgv(repo(d), snapshot) }, geheimVon(d), s);
  } catch {
    // the part fails all the same; prune never removes the snapshot of a failed part by mistake
  }
};

const teilSichern = async (
  deps: SichernDeps,
  d: BackupDatei,
  t: BackupTeil,
  lauf: AbortSignal,
): Promise<TeilStand> => {
  if (lauf.aborted) return fehlgeschlagen(t.tag, "Zeitlimit des Laufs überschritten");
  const ms = t.art === "volume" || t.zeitlimitS === undefined ? undefined : t.zeitlimitS * 1000;
  const f = frist(deps, ms, lauf);
  const { restic, quelle } = teilArgv(repo(d), t);
  let a: ResticAntwort;
  try {
    a = await deps.restic({ argv: restic, ...(quelle ? { quelle } : {}) }, geheimVon(d), f.signal);
  } catch {
    return fehlgeschlagen(t.tag, "restic startete nicht");
  } finally {
    f.aufheben();
  }
  const snapshot = snapshotAus(a.aus);
  const ueberschritten = lauf.aborted
    ? "Zeitlimit des Laufs überschritten"
    : f.abgelaufen()
      ? `Zeitlimit von ${(ms ?? 0) / 1000} s überschritten`
      : undefined;
  // restic failing first ends the source too (a closed pipe): restic's reason is the cause then
  const quelleFehler =
    quelle && a.code === 0 && a.quelleCode !== 0
      ? `die Quelle endete mit Code ${a.quelleCode ?? "–"}`
      : undefined;
  const grund = ueberschritten ?? quelleFehler;
  if (grund !== undefined) {
    if (snapshot !== undefined && !lauf.aborted) await verwerfen(deps, d, snapshot, lauf);
    return fehlgeschlagen(t.tag, grund);
  }
  if (a.code !== 0) return fehlgeschlagen(t.tag, resticGrund(a.code), snapshot);
  if (snapshot === undefined) return fehlgeschlagen(t.tag, "restic nannte keinen Snapshot");
  return { tag: t.tag, ok: true, snapshot };
};

const aufbewahren = async (
  deps: SichernDeps,
  d: BackupDatei,
  lauf: AbortSignal,
): Promise<string | undefined> => {
  try {
    const a = await deps.restic({ argv: forgetArgv(repo(d)) }, geheimVon(d), lauf);
    if (lauf.aborted) return "Aufbewahrung: Zeitlimit des Laufs überschritten";
    return a.code === 0 ? undefined : `Aufbewahrung: ${resticGrund(a.code)}`;
  } catch {
    return "Aufbewahrung: restic startete nicht";
  }
};

/** One run over all parts of backup.json; never throws */
export const sichern = async (deps: SichernDeps, d: BackupDatei): Promise<Lauf> => {
  const beginn = deps.jetzt();
  const f = frist(deps, LAUF_ZEITLIMIT_MS, new AbortController().signal);
  try {
    const teile: TeilStand[] = [];
    for (const t of d.teile) teile.push(await teilSichern(deps, d, t, f.signal));
    const gruende = teile.flatMap((t) => (t.ok ? [] : [`${t.tag}: ${t.fehler ?? ""}`]));
    if (gruende.length === 0) {
      const aufbewahrung = await aufbewahren(deps, d, f.signal);
      if (aufbewahrung !== undefined) gruende.push(aufbewahrung);
    }
    const fehler = gruende.join("; ").slice(0, 2000);
    return {
      lauf: deps.id(),
      beginn,
      ende: deps.jetzt(),
      ok: fehler === "",
      ...(fehler === "" ? {} : { fehler }),
      teile,
    };
  } finally {
    f.aufheben();
  }
};

export type Angelegt =
  | { ok: true; repository: "vorhanden" | "angelegt" }
  | { ok: false; grund: string };

/** The repository for setting up the backup: kept when it is there, else created */
export const repositoryAnlegen = async (
  deps: SichernDeps,
  d: BackupDatei,
  signal: AbortSignal = new AbortController().signal,
): Promise<Angelegt> => {
  const lauf = async (schritt: "pruefen" | "init") => {
    try {
      return (await deps.restic({ argv: anlegenArgv(repo(d), schritt) }, geheimVon(d), signal))
        .code;
    } catch {
      return -1;
    }
  };
  const grund = (code: number | null) =>
    code === -1 ? "Repository: restic startete nicht" : `Repository: ${resticGrund(code)}`;
  const da = await lauf("pruefen");
  if (da === 0) return { ok: true, repository: "vorhanden" };
  if (da !== 10) return { ok: false, grund: grund(da) };
  const neu = await lauf("init");
  return neu === 0 ? { ok: true, repository: "angelegt" } : { ok: false, grund: grund(neu) };
};

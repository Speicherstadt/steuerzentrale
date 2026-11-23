import {
  BACKUP_SERVICE,
  BACKUP_TIMER,
  type BackupTeil,
  type BackupZugang,
  backupUnits,
} from "@steuerzentrale/manifest";
import { installationVomManifest, type ManifestAngaben } from "../aktionen/geheimnisse.ts";
import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import { type EinrichtungsDeps, mitZeitlimit } from "../einrichtung/auftrag.ts";
import { SYSTEMD_NUTZER } from "../einrichtung/haus.ts";
import { laeufer } from "../einrichtung/lauf.ts";
import { alsNutzer, homeVon, type Nutzer, nutzerName } from "../einrichtung/nutzer.ts";
import type { PruefZiel } from "../zustand/ziel.ts";
import { BACKUP_ORDNER, type BackupDatei, backupDateiPfad } from "./datei.ts";
import { neuesterLauf } from "./stand.ts";

/*
 * The backup jobs on the agent (BAULISTE.md Z-601; docs/plan.md, "Backup auf dem Server"), after
 * key, signature and backupAuftragPruefen (auftraege/pruefen.ts), only for an installation this
 * agent set up and finished, whose units its record knows:
 * - `installation_backup_einrichten`, only when the units were rendered from the job's manifest
 *   (their labels), whose `backup` named the parts: backup.json written as root (0600, the user's,
 *   never through a symlink: haus.ts), the user's timer and service, daemon-reload, the timer
 *   enabled, then the agent's binary as the user creates the repository if it is missing. Run in
 *   the line of the setup jobs, so it never meets a setup half done;
 * - `installation_backup` starts the user's service and waits for its end, then reads the run's
 *   stand. Not in that line: a backup may take hours, and setting up waits for nothing of it.
 * No value of backup.json reaches an argv, a reason or the agent's log.
 */

export type Backup =
  | {
      art: "einrichten";
      name: string;
      teile: BackupTeil[];
      zugang: BackupZugang;
      /** From the job's signed manifest, to compare with the units' labels */
      manifest: ManifestAngaben;
    }
  | { art: "jetzt"; name: string };

export type BackupDeps = EinrichtungsDeps & {
  /** The agent's binary the service runs (backupUnits, AGENT_BINARY) */
  agent: string;
  jetzt: () => number;
};

const fehler = (text: string): Ergebnis => ({ ok: false, fehler: text });

/**
 * The finished installation's user, units and the target of its health check, or why the job is
 * refused (also Z-602, Z-603)
 */
export const fertigeInstallation = async (
  deps: Pick<EinrichtungsDeps, "gedaechtnis" | "nutzer">,
  name: string,
): Promise<
  { ok: true; n: Nutzer; units: string[]; ziel: PruefZiel } | { ok: false; grund: string }
> => {
  const g = await deps.gedaechtnis.lesen();
  if (!g.ok) return { ok: false, grund: `abgelehnt: ${g.grund}` };
  const eintrag = g.stand.get(name);
  if (eintrag?.zustand !== "fertig")
    return {
      ok: false,
      grund: `abgelehnt: ${name} ist keine fertig eingerichtete Installation dieses Agenten`,
    };
  const pruefung = eintrag.pruefung;
  if (pruefung === undefined)
    return { ok: false, grund: `abgelehnt: das Gedächtnis kennt die Units von ${name} nicht` };
  const n = await deps.nutzer(nutzerName(name));
  return n
    ? { ok: true, n, units: pruefung.units, ziel: pruefung.ziel }
    : { ok: false, grund: `abgelehnt: ${nutzerName(name)} fehlt` };
};

/** Each folder from the home down, so none of them is a symlink the user put there (haus.ts) */
const ordnerAnlegen = async (deps: BackupDeps, home: string, n: Nutzer) => {
  for (const relativ of [BACKUP_ORDNER, SYSTEMD_NUTZER]) {
    const teile = relativ.split("/");
    for (let i = 1; i <= teile.length; i++)
      await deps.haus.verzeichnis(`${home}/${teile.slice(0, i).join("/")}`, 0o700, n);
  }
};

/** The answer of `sichern --repository-anlegen`, its last line of JSON */
const repositoryAntwort = (aus: string): { repository?: string; grund?: string } => {
  try {
    const zeilen = aus.trim().split("\n");
    return JSON.parse(zeilen.at(-1) ?? "{}");
  } catch {
    return {};
  }
};

const einrichten = async (
  deps: BackupDeps,
  a: Extract<Backup, { art: "einrichten" }>,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  const inst = await fertigeInstallation(deps, a.name);
  if (!inst.ok) return fehler(inst.grund);
  const { n, units } = inst;
  const passt = await installationVomManifest(deps, n, units, a.manifest);
  if (!passt.ok) return fehler(`abgelehnt: ${passt.grund}`);
  const home = homeVon(a.name);
  const datei: BackupDatei = { installation: a.name, ...a.zugang, teile: a.teile };
  try {
    await ordnerAnlegen(deps, home, n);
    await deps.haus.schreiben(backupDateiPfad(home), JSON.stringify(datei), 0o600, n);
    for (const [unit, text] of Object.entries(backupUnits(a.name, deps.agent)))
      await deps.haus.schreiben(`${home}/${SYSTEMD_NUTZER}/${unit}`, text, 0o600, n);
  } catch (e) {
    return fehler(`Backup einrichten: ${String(e).slice(0, 500)}`);
  }
  return mitZeitlimit(deps, zeitlimitMs, async (signal) => {
    const lauf = laeufer(deps, signal);
    for (const [schritt, argv] of [
      ["systemctl --user daemon-reload", ["systemctl", "--user", "daemon-reload"]],
      ["systemctl --user enable", ["systemctl", "--user", "enable", "--now", BACKUP_TIMER]],
    ] as const) {
      const r = await lauf(schritt, alsNutzer(n, argv));
      if (!r.ok) return fehler(`Backup einrichten: ${r.grund}`);
    }
    const argv = alsNutzer(n, [deps.agent, "sichern", a.name, "--repository-anlegen"]);
    const r = await deps.lesen(argv, signal).catch(() => ({ code: null, aus: "" }));
    const antwort = repositoryAntwort(r.aus);
    if (r.code !== 0)
      return fehler(
        `Backup einrichten: ${signal.aborted ? "Zeitlimit des Auftrags überschritten" : (antwort.grund ?? `sichern endete mit Code ${r.code ?? "–"}`)}`,
      );
    return {
      ok: true,
      daten: {
        installation: a.name,
        repository: antwort.repository ?? "vorhanden",
        teile: a.teile.map((t) => t.tag),
        timer: BACKUP_TIMER,
      },
    };
  });
};

const jetzt = async (
  deps: BackupDeps,
  a: Extract<Backup, { art: "jetzt" }>,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  const inst = await fertigeInstallation(deps, a.name);
  if (!inst.ok) return fehler(inst.grund);
  const home = homeVon(a.name);
  if (!(await deps.haus.existiert(`${home}/${SYSTEMD_NUTZER}/${BACKUP_SERVICE}`)))
    return fehler(`abgelehnt: das Backup von ${a.name} ist nicht eingerichtet`);
  const start = deps.jetzt();
  return mitZeitlimit(deps, zeitlimitMs, async (signal) => {
    // a oneshot service: start returns once the run has ended, or joins one already running
    const r = await laeufer(deps, signal)(
      "systemctl --user start",
      alsNutzer(inst.n, ["systemctl", "--user", "start", BACKUP_SERVICE]),
    );
    // read on its own time: the stand of a run that outlasted the job still names its reason
    const lauf = await neuesterLauf(deps, inst.n, a.name, start);
    if (lauf?.ok)
      return { ok: true, daten: { installation: a.name, lauf: lauf.lauf, teile: lauf.teile } };
    if (lauf) return fehler(`Backup gescheitert: ${lauf.fehler ?? "ohne Grund"}`);
    return fehler(`Backup gescheitert: ${r.ok ? "kein Stand des Laufs" : r.grund}`);
  });
};

export const backupAusfuehren = async (
  deps: BackupDeps,
  plan: { auftrag: Backup; zeitlimitMs: number },
): Promise<Ergebnis> => {
  try {
    return plan.auftrag.art === "einrichten"
      ? await einrichten(deps, plan.auftrag, plan.zeitlimitMs)
      : await jetzt(deps, plan.auftrag, plan.zeitlimitMs);
  } catch (e) {
    return fehler(`Backup: ${String(e).slice(0, 500)}`);
  }
};

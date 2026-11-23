import {
  BACKUP_SERVICE,
  BACKUP_TIMER,
  type RestoreTeil,
  type WiederherstellenDaten,
} from "@steuerzentrale/manifest";
import { installationVomManifest, type ManifestAngaben } from "../aktionen/geheimnisse.ts";
import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import { fertigeInstallation } from "../backup/auftrag.ts";
import { type EinrichtungsDeps, mitZeitlimit } from "../einrichtung/auftrag.ts";
import { unitsStarten } from "../einrichtung/einrichten.ts";
import { type Lauf, laeufer } from "../einrichtung/lauf.ts";
import { neustarten } from "../einrichtung/neustarten.ts";
import { alsNutzer, type Nutzer } from "../einrichtung/nutzer.ts";
import { gelungen, type Schrittergebnis } from "../einrichtung/typen.ts";
import { gemeldet, healthAbwarten } from "../pruef-restore/auftrag.ts";
import { quelleLesen } from "../pruef-restore/quelle.ts";
import {
  type TeilErgebnis,
  teileVorher,
  type ZurueckDeps,
  zurueckspielen,
} from "../pruef-restore/zurueckspielen.ts";
import type { PruefDeps } from "../zustand/pruefen.ts";
import type { PruefZiel } from "../zustand/ziel.ts";
import { inEigenerUnit, restSekunden, WIEDERHERSTELLEN_UNIT } from "./unit.ts";

/*
 * Restoring an installation on the agent (BAULISTE.md Z-603; docs/plan.md, "Wiederherstellen auf
 * dem Server (Z-603)"), after key, signature and wiederherstellenAuftragPruefen
 * (auftraege/pruefen.ts), only for an installation this agent set up and finished, whose units
 * were rendered from the job's manifest (their labels) and whose backup is set up here (its
 * backup.json). As its user: the backup's timer stopped, and refused while a backup runs; the units
 * stopped, all of them when a volume is played back, else all but the database containers of the
 * dumps; each volume removed and made anew by its unit (empty); then zurueckspielen with the job's
 * snapshots, each part in a transient unit of the user (unit.ts); all units started and active,
 * the health by the manifest not red within five minutes; the timer started again.
 *
 * A step that fails, or the job's time limit, ends it: the transient unit is stopped (with every
 * process in it), the units are reset and restarted until they stay active, and the timer is
 * started, each step with a time limit of its own and each one also when one before failed. The
 * result names the reason, and whether the units run again; the backup of the state before (which
 * the Zentrale made first) lies ready. Run in the line of the setup jobs, and not again after a
 * restart of the agent (pruefen.ts): it would stop the app and replace data at a time nobody chose.
 * A restore that succeeded reports its parts and duration like a Prüf-Restore.
 */

export type Wiederherstellen = {
  art: "wiederherstellen";
  name: string;
  teile: RestoreTeil[];
  netz: { name: string; unit: string };
  /** The snapshot of each part that is played back, by its tag */
  snapshots: Readonly<Record<string, string>>;
  /** From the job's signed manifest, to compare with the units' labels */
  manifest: ManifestAngaben;
};

export type WiederherstellenDeps = EinrichtungsDeps &
  ZurueckDeps &
  Pick<PruefDeps, "holen" | "verbinden"> & { jetzt: () => number };

type Installation = { n: Nutzer; units: string[]; ziel: PruefZiel };

/** Each step of starting the units again, apart from the job's time limit, which may be over */
const SCHRITT_MS = 60_000;

const fehler = (text: string): Ergebnis => ({ ok: false, fehler: text });

const vorabPruefen = async (
  deps: WiederherstellenDeps,
  a: Wiederherstellen,
): Promise<{ ok: true; inst: Installation } | { ok: false; grund: string }> => {
  const inst = await fertigeInstallation(deps, a.name);
  if (!inst.ok) return { ok: false, grund: inst.grund.replace(/^abgelehnt: /, "") };
  const passt = await installationVomManifest(deps, inst.n, inst.units, a.manifest);
  if (!passt.ok) return passt;
  const q = await quelleLesen(deps.haus, inst.n, a.name);
  if (!q.ok) return q;
  return { ok: true, inst };
};

/** The units stopped: all when a volume is replaced, else all but the dumps' databases */
const zuStoppen = (a: Wiederherstellen, units: readonly string[]): string[] => {
  if (a.teile.some((t) => t.art === "volume")) return [...units];
  const datenbanken = a.teile.flatMap((t) => (t.art === "pg_dump" ? [t.unit] : []));
  return units.filter((u) => !datenbanken.includes(u));
};

/** Each volume removed and made anew by its unit, so that the snapshot goes into an empty one */
const volumesLeeren = async (lauf: Lauf, n: Nutzer, a: Wiederherstellen) => {
  const volumes = a.teile.flatMap((t) => (t.art === "volume" ? [t] : []));
  if (volumes.length === 0) return gelungen;
  const weg = await lauf(
    "podman volume rm",
    alsNutzer(n, ["podman", "volume", "rm", "--force", ...volumes.map((t) => t.volume)]),
  );
  if (!weg.ok) return weg;
  return lauf(
    "systemctl --user restart",
    alsNutzer(n, ["systemctl", "--user", "restart", ...volumes.map((t) => t.unit)]),
  );
};

/**
 * Whether a run of the backup goes on, or may: sz_backup.service is Type=oneshot, which systemd
 * shows `activating` while its run goes on, and `systemctl is-active` exits 3 for that state
 * (systemctl(1), is-active; systemd.service(5)), so its exit code alone does not tell. Only
 * `inactive` and `failed` count as no run; any other answer, or none, as one.
 */
const backupLaeuft = async (deps: WiederherstellenDeps, n: Nutzer, signal: AbortSignal) => {
  const argv = alsNutzer(n, ["systemctl", "--user", "is-active", BACKUP_SERVICE]);
  const r = await deps.lesen(argv, signal).catch(() => ({ code: null, aus: "" }));
  return !["inactive", "failed"].includes(r.aus.trim());
};

type Ablauf = { grund?: string; teile: TeilErgebnis[] };

/** Stopped, emptied, played back, started and checked; the first step that fails ends it */
const ablauf = async (
  deps: WiederherstellenDeps,
  a: Wiederherstellen,
  inst: Installation,
  ende: number,
  signal: AbortSignal,
): Promise<Ablauf> => {
  const vorher = teileVorher(a.teile);
  const lauf = laeufer(deps, signal);
  const systemctl = (...argv: string[]) => alsNutzer(inst.n, ["systemctl", "--user", ...argv]);
  const timer = await lauf("systemctl --user stop", systemctl("stop", BACKUP_TIMER));
  if (!timer.ok) return { grund: timer.grund, teile: vorher };
  if (await backupLaeuft(deps, inst.n, signal))
    return { grund: `ein Backup von ${a.name} läuft gerade`, teile: vorher };
  const stoppen = zuStoppen(a, inst.units);
  if (stoppen.length > 0) {
    const r = await lauf("systemctl --user stop", systemctl("stop", ...stoppen));
    if (!r.ok) return { grund: r.grund, teile: vorher };
  }
  const leer = await volumesLeeren(lauf, inst.n, a);
  if (!leer.ok) return { grund: leer.grund, teile: vorher };
  const z = await zurueckspielen(
    deps,
    {
      quelle: a.name,
      ziel: a.name,
      teile: a.teile,
      netz: a.netz,
      snapshots: a.snapshots,
      inUnit: (argv) => inEigenerUnit(restSekunden(ende, deps.jetzt()), argv),
    },
    signal,
  );
  if (!z.ok) return { grund: z.grund ?? "Zurückspielen gescheitert", teile: z.teile };
  const start = await unitsStarten(deps, lauf, inst.n, inst.units, signal);
  if (!start.ok) return { grund: `Start: ${start.grund}`, teile: z.teile };
  const health = await healthAbwarten(deps, { ziel: inst.ziel, name: a.name }, inst.n, signal);
  if (health.zustand === "rot") return { grund: `Health: ${health.grund}`, teile: z.teile };
  return { teile: z.teile };
};

/** Every step runs, each with its own time limit; the first failure is the answer */
const alleVersuchen = async (
  schritte: (() => Promise<Schrittergebnis>)[],
): Promise<Schrittergebnis> => {
  let erster: Schrittergebnis = gelungen;
  for (const s of schritte) {
    const r = await s();
    if (!r.ok && erster.ok) erster = r;
  }
  return erster;
};

/** After a failure: the transient unit with all its processes gone, the units and the timer up */
const wiederStarten = (deps: WiederherstellenDeps, inst: Installation) => {
  const lauf: Lauf = (schritt, argv, o = {}) =>
    laeufer(deps)(schritt, argv, { zeitlimitMs: SCHRITT_MS, ...o });
  const systemctl = (...argv: string[]) => alsNutzer(inst.n, ["systemctl", "--user", ...argv]);
  return alleVersuchen([
    // a unit that already ended is gone (--collect): stop then fails, which tells nothing
    async () => {
      await lauf("systemctl --user stop", systemctl("stop", WIEDERHERSTELLEN_UNIT));
      return gelungen;
    },
    () => neustarten(deps, lauf, inst.n, inst.units),
    () => lauf("systemctl --user start", systemctl("start", BACKUP_TIMER)),
  ]);
};

const durchfuehren = async (
  deps: WiederherstellenDeps,
  a: Wiederherstellen,
  inst: Installation,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  const beginn = deps.jetzt();
  let l: Ablauf;
  try {
    l = await mitZeitlimit(deps, zeitlimitMs, (signal) =>
      ablauf(deps, a, inst, beginn + zeitlimitMs, signal),
    );
  } catch (e) {
    l = { grund: String(e).slice(0, 500), teile: teileVorher(a.teile) };
  }
  if (l.grund !== undefined) {
    const zurueck = await wiederStarten(deps, inst);
    const units = zurueck.ok
      ? "Units wieder gestartet"
      : `Units nicht wieder gestartet: ${zurueck.grund}`;
    return fehler(`Wiederherstellen gescheitert: ${l.grund}; ${units}`);
  }
  const timer = await laeufer(deps)(
    "systemctl --user start",
    alsNutzer(inst.n, ["systemctl", "--user", "start", BACKUP_TIMER]),
    { zeitlimitMs: SCHRITT_MS },
  );
  if (!timer.ok) return fehler(`Wiederherstellen: Backup-Timer nicht gestartet: ${timer.grund}`);
  const daten: WiederherstellenDaten = {
    teile: l.teile.map(gemeldet),
    dauerMs: Math.max(0, deps.jetzt() - beginn),
  };
  return { ok: true, daten };
};

export const wiederherstellenAusfuehren = async (
  deps: WiederherstellenDeps,
  plan: { auftrag: Wiederherstellen; zeitlimitMs: number },
): Promise<Ergebnis> => {
  try {
    const v = await vorabPruefen(deps, plan.auftrag);
    if (!v.ok) return fehler(`abgelehnt: ${v.grund}`);
    return await durchfuehren(deps, plan.auftrag, v.inst, plan.zeitlimitMs);
  } catch (e) {
    return fehler(`Wiederherstellen: ${String(e).slice(0, 500)}`);
  }
};

import { BACKUP_SERVICE, BACKUP_TIMER, type RestoreTeil } from "@steuerzentrale/manifest";
import { alleVersuchen } from "../einrichtung/einrichten.ts";
import { type Lauf, laeufer } from "../einrichtung/lauf.ts";
import { neustarten } from "../einrichtung/neustarten.ts";
import { alsNutzer, type Nutzer } from "../einrichtung/nutzer.ts";
import { gelungen, type Schrittergebnis, type SystemDeps } from "../einrichtung/typen.ts";
import {
  teileVorher,
  type ZurueckDeps,
  type Zurueckgespielt,
  zurueckspielen,
} from "../pruef-restore/zurueckspielen.ts";
import { inEigenerUnit, restSekunden, WIEDERHERSTELLEN_UNIT } from "./unit.ts";

/*
 * The steps of putting an installation's data back from chosen snapshots of its backup, shared by
 * restoring (Z-603, auftrag.ts) and rolling an update back (Z-503, src/update): the backup's timer
 * stopped and no run going on, each volume emptied, each part played back in the transient unit
 * (unit.ts), and after a failure the transient unit stopped, the units restarted and the timer
 * started again, each with a time limit of its own.
 */

/** Each step of starting the units again after a failure, apart from the job's time limit */
export const SCHRITT_MS = 60_000;

/** The data played back: the installation, its parts and network, the snapshot of each part */
export type Daten = {
  name: string;
  teile: readonly RestoreTeil[];
  netz: { unit: string };
  snapshots: Readonly<Record<string, string>>;
};

const systemctl = (n: Nutzer, ...argv: string[]) => alsNutzer(n, ["systemctl", "--user", ...argv]);

/**
 * Whether a run of the backup goes on, or may: sz_backup.service is Type=oneshot, which systemd
 * shows `activating` while its run goes on, and `systemctl is-active` exits 3 for that state
 * (systemctl(1), is-active; systemd.service(5)), so its exit code alone does not tell. Only
 * `inactive` and `failed` count as no run; any other answer, or none, as one.
 */
const backupLaeuft = async (deps: Pick<SystemDeps, "lesen">, n: Nutzer, signal: AbortSignal) => {
  const r = await deps
    .lesen(systemctl(n, "is-active", BACKUP_SERVICE), signal)
    .catch(() => ({ code: null, aus: "" }));
  return !["inactive", "failed"].includes(r.aus.trim());
};

/** The backup's timer stopped, and no run of it going on; refused while one runs */
export const backupAnhalten = async (
  deps: Pick<SystemDeps, "lesen">,
  lauf: Lauf,
  n: Nutzer,
  name: string,
  signal: AbortSignal,
): Promise<Schrittergebnis> => {
  const timer = await lauf("systemctl --user stop", systemctl(n, "stop", BACKUP_TIMER));
  if (!timer.ok) return timer;
  if (await backupLaeuft(deps, n, signal))
    return { ok: false, grund: `ein Backup von ${name} läuft gerade` };
  return gelungen;
};

/** The backup's timer started again, with a time limit of its own */
export const timerStarten = (deps: Pick<SystemDeps, "spawn" | "planen">, n: Nutzer) =>
  laeufer(deps)("systemctl --user start", systemctl(n, "start", BACKUP_TIMER), {
    zeitlimitMs: SCHRITT_MS,
  });

/** Each volume removed and made anew by its unit, so that the snapshot goes into an empty one */
const volumesLeeren = async (lauf: Lauf, n: Nutzer, teile: readonly RestoreTeil[]) => {
  const volumes = teile.flatMap((t) => (t.art === "volume" ? [t] : []));
  if (volumes.length === 0) return gelungen;
  const weg = await lauf(
    "podman volume rm",
    alsNutzer(n, ["podman", "volume", "rm", "--force", ...volumes.map((t) => t.volume)]),
  );
  if (!weg.ok) return weg;
  return lauf("systemctl --user restart", systemctl(n, "restart", ...volumes.map((t) => t.unit)));
};

/**
 * The volumes emptied, then each part played back with its snapshot in the transient unit, which
 * ends by `ende` (an instant) at the latest; the units that would write beside it are stopped by
 * the caller
 */
export const datenZurueckspielen = async (
  deps: ZurueckDeps & { jetzt: () => number },
  d: Daten,
  n: Nutzer,
  ende: number,
  signal: AbortSignal,
): Promise<Zurueckgespielt> => {
  const leer = await volumesLeeren(laeufer(deps, signal), n, d.teile);
  if (!leer.ok) return { ok: false, grund: leer.grund, teile: teileVorher(d.teile) };
  const z = await zurueckspielen(
    deps,
    {
      quelle: d.name,
      ziel: d.name,
      teile: d.teile,
      netz: d.netz,
      snapshots: d.snapshots,
      inUnit: (argv) => inEigenerUnit(restSekunden(ende, deps.jetzt()), argv),
    },
    signal,
  );
  return z.ok ? z : { ...z, grund: z.grund ?? "Zurückspielen gescheitert" };
};

/**
 * After a failure: the transient unit with all its processes gone, the units restarted until they
 * stay active and the backup's timer started, each step with its own time limit and each one also
 * when one before failed
 */
export const wiederStarten = (
  deps: Pick<SystemDeps, "spawn" | "planen" | "warten">,
  n: Nutzer,
  units: readonly string[],
): Promise<Schrittergebnis> => {
  const lauf: Lauf = (schritt, argv, o = {}) =>
    laeufer(deps)(schritt, argv, { zeitlimitMs: SCHRITT_MS, ...o });
  return alleVersuchen([
    // a unit that already ended is gone (--collect): stop then fails, which tells nothing
    async () => {
      await lauf("systemctl --user stop", systemctl(n, "stop", WIEDERHERSTELLEN_UNIT));
      return gelungen;
    },
    () => neustarten(deps, lauf, n, units),
    () => timerStarten(deps, n),
  ]);
};

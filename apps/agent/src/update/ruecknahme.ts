import { mitZeitlimit } from "../einrichtung/auftrag.ts";
import { nacheinander } from "../einrichtung/einrichten.ts";
import { laeufer } from "../einrichtung/lauf.ts";
import { neustarten } from "../einrichtung/neustarten.ts";
import { alsNutzer, type Nutzer } from "../einrichtung/nutzer.ts";
import { type AlterStand, standZurueck } from "../einrichtung/stand.ts";
import { gelungen, gescheitert, type Schrittergebnis } from "../einrichtung/typen.ts";
import { healthAbwarten } from "../pruef-restore/auftrag.ts";
import type { WiederherstellenDeps } from "../wiederherstellen/auftrag.ts";
import { datenZurueckspielen, timerStarten, wiederStarten } from "../wiederherstellen/daten.ts";
import type { PruefZiel } from "../zustand/ziel.ts";
import type { Update } from "./auftrag.ts";
import { neuLaden } from "./stand.ts";

/*
 * Rolling an update back (BAULISTE.md Z-503; docs/plan.md, "Update auf dem Server (Z-503)"), as
 * the installation's user, within the rest of the job's time: the units of both versions stopped,
 * the old files and secrets back (einrichtung/stand.ts), `daemon-reload`; if the new version ran
 * (`mitDaten`), its data are replaced by the backup made just before: each volume emptied and each
 * part played back with the job's snapshots in the transient unit, as restoring does
 * (wiederherstellen/daten.ts); then the old units restarted until they stay active and their health
 * by the old target not red within five minutes, and the backup's timer started. The old images
 * are still in the user's storage: nothing is pulled. The first step that fails ends it; then the
 * transient unit is stopped, the old units restarted and the timer started, each with a time limit
 * of its own, so as much of the old version runs as can.
 */

/** The installation as it was before the update */
export type Vorher = { n: Nutzer; units: string[]; ziel: PruefZiel; alt: AlterStand };

const ok = (r: { ok: boolean; grund?: string }, vorne = ""): Schrittergebnis =>
  r.ok ? gelungen : gescheitert(`${vorne}${r.grund ?? "gescheitert"}`);

const schritte = (
  deps: WiederherstellenDeps,
  a: Update,
  v: Vorher,
  mitDaten: boolean,
  ende: number,
  signal: AbortSignal,
): Promise<Schrittergebnis> => {
  const lauf = laeufer(deps, signal);
  const alle = [...new Set([...a.units, ...v.units])];
  return nacheinander([
    () => lauf("systemctl --user stop", alsNutzer(v.n, ["systemctl", "--user", "stop", ...alle])),
    () => standZurueck(deps, lauf, v.n, v.alt, Object.keys(a.quadlets.secrets)),
    () => neuLaden(lauf, v.n),
    ...(mitDaten
      ? [async () => ok(await datenZurueckspielen(deps, a, v.n, ende, signal), "Daten: ")]
      : []),
    () => neustarten(deps, lauf, v.n, v.units, signal),
    async () => {
      const h = await healthAbwarten(deps, { ziel: v.ziel, name: a.name }, v.n, signal);
      return h.zustand === "rot" ? gescheitert(`Health: ${h.grund}`) : gelungen;
    },
  ]);
};

/** Rolls back by `ende` (an instant); the reason when the old version does not run as before */
export const zuruecknehmen = async (
  deps: WiederherstellenDeps,
  a: Update,
  v: Vorher,
  mitDaten: boolean,
  ende: number,
): Promise<Schrittergebnis> => {
  let r: Schrittergebnis;
  try {
    r = await mitZeitlimit(deps, Math.max(0, ende - deps.jetzt()), (signal) =>
      schritte(deps, a, v, mitDaten, ende, signal),
    );
  } catch (fehler) {
    r = gescheitert(String(fehler).slice(0, 500));
  }
  if (!r.ok) {
    const wieder = await wiederStarten(deps, v.n, v.units);
    return gescheitert(
      `${r.grund}; ${wieder.ok ? "alte Units wieder gestartet" : `alte Units nicht wieder gestartet: ${wieder.grund}`}`,
    );
  }
  return ok(await timerStarten(deps, v.n), "Backup-Timer nicht gestartet: ");
};

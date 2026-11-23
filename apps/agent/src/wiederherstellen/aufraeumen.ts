import { BACKUP_TIMER } from "@steuerzentrale/manifest";
import { fertigeInstallation } from "../backup/auftrag.ts";
import type { EinrichtungsDeps } from "../einrichtung/auftrag.ts";
import { laeufer } from "../einrichtung/lauf.ts";
import { alsNutzer, type Nutzer } from "../einrichtung/nutzer.ts";
import { gelungen, type Schrittergebnis } from "../einrichtung/typen.ts";
import { quelleLesen } from "../pruef-restore/quelle.ts";
import { WIEDERHERSTELLEN_UNIT } from "./unit.ts";

/*
 * What a restore leaves when the agent stops in its middle (BAULISTE.md Z-603; docs/plan.md,
 * "Neustart des Agenten beim Wiederherstellen (Z-603)"), set right once when the agent starts: the
 * restore is not run again (auftraege.ts), and the agent cannot tell how far the playing back
 * came. For each installation it set up and finished whose backup is set up here (backup.json), as
 * its user: a transient unit still playing back is stopped, so it does not write beside an app
 * started again; and the backup's timer is started (idempotent), without which no backup would run.
 * The app's units are left as they are: the health shows them stopped, and the action "Neustart"
 * starts them. An update (Z-503, src/update) leaves the same behind: its rollback plays back in
 * the same transient unit, and it stops the timer too. Both steps run even when the first fails; a failure is the installation's alone.
 */

export type Aufgeraeumt =
  | { ok: true; installationen: string[]; fehler: { installation: string; grund: string }[] }
  | { ok: false; grund: string };

/** Each step with a time limit of its own, as after a failed restore (auftrag.ts) */
const SCHRITT_MS = 60_000;

/**
 * Stops the transient unit; a stop that fails (as for a unit `--collect` already unloaded, which
 * systemctl does not find) counts when the unit is no longer active or activating
 */
const transienteStoppen = async (deps: EinrichtungsDeps, n: Nutzer): Promise<Schrittergebnis> => {
  const lauf = laeufer(deps);
  const stopp = await lauf(
    "systemctl --user stop",
    alsNutzer(n, ["systemctl", "--user", "stop", WIEDERHERSTELLEN_UNIT]),
    { zeitlimitMs: SCHRITT_MS },
  );
  if (stopp.ok) return stopp;
  const frage = new AbortController();
  const aufheben = deps.planen(() => frage.abort(), SCHRITT_MS);
  try {
    const argv = alsNutzer(n, ["systemctl", "--user", "is-active", WIEDERHERSTELLEN_UNIT]);
    const r = await deps.lesen(argv, frage.signal).catch(() => ({ code: null, aus: "" }));
    return ["inactive", "failed"].includes(r.aus.trim()) ? gelungen : stopp;
  } finally {
    aufheben();
  }
};

const timerStarten = (deps: EinrichtungsDeps, n: Nutzer) =>
  laeufer(deps)(
    "systemctl --user start",
    alsNutzer(n, ["systemctl", "--user", "start", BACKUP_TIMER]),
    { zeitlimitMs: SCHRITT_MS },
  );

/** One installation: undefined when there is nothing of it to set right, else the first failure */
const installationAufraeumen = async (
  deps: EinrichtungsDeps,
  name: string,
): Promise<Schrittergebnis | undefined> => {
  const inst = await fertigeInstallation(deps, name);
  if (!inst.ok) return undefined;
  const q = await quelleLesen(deps.haus, inst.n, name);
  if (!q.ok) return undefined;
  const stopp = await transienteStoppen(deps, inst.n);
  const timer = await timerStarten(deps, inst.n);
  return stopp.ok ? timer : stopp;
};

export const wiederherstellenAufraeumen = async (deps: EinrichtungsDeps): Promise<Aufgeraeumt> => {
  const g = await deps.gedaechtnis.lesen();
  if (!g.ok) return g;
  const namen = [...g.stand].filter(([, e]) => e.zustand === "fertig").map(([name]) => name);
  const installationen: string[] = [];
  const fehler: { installation: string; grund: string }[] = [];
  for (const name of namen) {
    const r = await installationAufraeumen(deps, name).catch(
      (e: unknown): Schrittergebnis => ({ ok: false, grund: String(e).slice(0, 500) }),
    );
    if (r === undefined) continue;
    if (r.ok) installationen.push(name);
    else fehler.push({ installation: name, grund: r.grund });
  }
  return { ok: true, installationen, fehler };
};

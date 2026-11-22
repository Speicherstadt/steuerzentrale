import { bisAktiv, nacheinander, sindAktiv } from "./einrichten.ts";
import type { Lauf } from "./lauf.ts";
import { alsNutzer, type Nutzer } from "./nutzer.ts";
import { gelungen, gescheitert, type Schrittergebnis, type SystemDeps } from "./typen.ts";

/*
 * Restarting the units of an installation (docs/plan.md, "Aktiv nach dem Neustart"), as
 * reconfiguring (Z-404, konfigurieren.ts) and the action restart (Z-405, src/aktionen) do it:
 * `systemctl --user reset-failed` of the units, whose code does not count, then `restart`, then
 * waiting until they are active and stay active for a while. Quadlet's units restart always: an
 * app that fails at its start is active for a moment, then restarts until systemd's start limit
 * (5 in 10 s) makes it fail, and that limit refuses a manual restart until its counter is reset.
 */

/** An app that fails at its start fails within this; one that stays up this long counts as up */
const STABIL_VERSUCHE = 10;
const STABIL_WARTEN_MS = 1000;

/** Active now, and still active after a while (Restart=always hides an app that fails at start) */
const aktivBleiben = async (
  deps: Pick<SystemDeps, "warten">,
  lauf: Lauf,
  n: Nutzer,
  units: readonly string[],
  auftrag?: AbortSignal,
): Promise<Schrittergebnis> => {
  const aktiv = await bisAktiv(deps, lauf, n, units, auftrag);
  if (!aktiv.ok) return aktiv;
  for (let i = 0; i < STABIL_VERSUCHE; i++) {
    await deps.warten(STABIL_WARTEN_MS);
    if (!(await sindAktiv(lauf, n, units)))
      return gescheitert(`units did not stay active: ${units.join(", ")}`);
  }
  return gelungen;
};

/** Restarts the units and waits until they are active and stay so; the first failure is the answer */
export const neustarten = (
  deps: Pick<SystemDeps, "warten">,
  lauf: Lauf,
  n: Nutzer,
  units: readonly string[],
  auftrag?: AbortSignal,
): Promise<Schrittergebnis> => {
  const systemctl = (...argv: string[]) => alsNutzer(n, ["systemctl", "--user", ...argv]);
  return nacheinander([
    // a unit that hit systemd's start limit refuses a manual restart within the limit's interval
    // until its counter is reset; a unit that did not is unchanged, and whether it did is told by
    // the restart, not by this
    async () => {
      await lauf("systemctl --user reset-failed", systemctl("reset-failed", ...units));
      return gelungen;
    },
    () => lauf("systemctl --user restart", systemctl("restart", ...units)),
    () => aktivBleiben(deps, lauf, n, units, auftrag),
  ]);
};

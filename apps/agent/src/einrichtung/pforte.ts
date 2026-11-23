import { PFORTE_UNIT, pforteUnit } from "@steuerzentrale/manifest";
import { UNITS } from "./haus.ts";
import type { Lauf } from "./lauf.ts";
import { alsNutzer, PFORTE_NUTZER } from "./nutzer.ts";
import { gescheitert, type Schrittergebnis, type SystemDeps } from "./typen.ts";

/*
 * Before an app behind the Pforte is set up (proxy: geteilt), its unit (pforteUnit) is written
 * under sz-pforte and started (docs/plan.md, "Nutzer und Unit der Pforte"), the same way as the
 * units of an installation. Idempotent: the unit is written only when it differs, and a running
 * Pforte is left as it is. A unit that is already there but does not run is loaded again before its
 * start: another job at the same time may have written it while its daemon-reload has not finished,
 * and until then systemd does not know sz-pforte.service (a bare start ends with 5, CI run
 * 45134053414). sz-pforte comes from install.sh; without it there is no Pforte, and the agent does
 * not make that user itself.
 */

export const PFORTE_SERVICE = PFORTE_UNIT.replace(/\.container$/, ".service");

export const pforteSicherstellen = async (
  deps: SystemDeps,
  lauf: Lauf,
): Promise<Schrittergebnis> => {
  const n = await deps.nutzer(PFORTE_NUTZER);
  if (!n) return gescheitert(`${PFORTE_NUTZER} is missing: install.sh makes the Pforte's user`);
  const teile = UNITS.split("/");
  try {
    for (let i = 1; i <= teile.length; i++)
      await deps.haus.verzeichnis(`${n.home}/${teile.slice(0, i).join("/")}`, 0o700, n);
    const pfad = `${n.home}/${UNITS}/${PFORTE_UNIT}`;
    const unit = pforteUnit();
    if ((await deps.haus.lesen(pfad)) === unit) {
      const laeuft = await lauf(
        "Pforte: systemctl --user is-active",
        alsNutzer(n, ["systemctl", "--user", "is-active", "--quiet", PFORTE_SERVICE]),
      );
      if (laeuft.ok) return laeuft;
    } else await deps.haus.schreiben(pfad, unit, 0o600, n);
    const neu = await lauf(
      "Pforte: systemctl --user daemon-reload",
      alsNutzer(n, ["systemctl", "--user", "daemon-reload"]),
    );
    if (!neu.ok) return neu;
  } catch (fehler) {
    return gescheitert(`Pforte: ${String(fehler).slice(0, 500)}`);
  }
  return lauf(
    "Pforte: systemctl --user start",
    alsNutzer(n, ["systemctl", "--user", "start", PFORTE_SERVICE]),
  );
};

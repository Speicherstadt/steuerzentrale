import type { PforteGrund } from "@steuerzentrale/manifest";
import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import type { PfortePlan } from "../auftraege/pruefen.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import { type Admin, routeEntfernen, routeSetzen } from "./admin.ts";

/*
 * Running a checked job of the Pforte (BAULISTE.md Z-401): the route through the admin API, aborted
 * when its time limit runs out. No process is started.
 */

export type PforteDeps = { admin: Admin; grund: PforteGrund };

export const pforteAusfuehren = async (
  deps: { pforte: PforteDeps; planen: Planer },
  plan: PfortePlan,
): Promise<Ergebnis> => {
  const abbruch = new AbortController();
  let abgelaufen = false;
  const aufheben = deps.planen(() => {
    abgelaufen = true;
    abbruch.abort();
  }, plan.zeitlimitMs);
  try {
    const { admin, grund } = deps.pforte;
    const a = plan.auftrag;
    const ergebnis =
      a.art === "setzen"
        ? await routeSetzen(admin, grund, a.route, abbruch.signal)
        : await routeEntfernen(admin, a.id, abbruch.signal);
    return abgelaufen
      ? { ok: false, fehler: `Zeitlimit von ${plan.zeitlimitMs / 1000} s überschritten` }
      : ergebnis;
  } finally {
    aufheben();
  }
};

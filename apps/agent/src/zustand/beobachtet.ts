import {
  type BeobachteterDienst,
  linuxNutzerGueltig,
  type NachrichtVomAgenten,
  unitGueltig,
} from "@steuerzentrale/protokoll";
import { alsNutzer, type NutzerLesen } from "../einrichtung/nutzer.ts";
import {
  aktivVon,
  bloeckeLesen,
  type Health,
  healthPruefen,
  mitFrist,
  type PruefDeps,
  UNITS_MS,
  type Unit,
} from "./pruefen.ts";
import type { PruefZiel } from "./ziel.ts";

/*
 * Units no manifest describes (BAULISTE.md Z-1103; docs/plan.md, "Vorhandene Units lesen"): of the
 * observed services the Zentrale names in `beobachten`, only on a server that is only observed. The
 * agent reads their state with `systemctl show` and fixed argv, as their user or of the system,
 * and checks health on 127.0.0.1 as for an installation (pruefen.ts); it starts and stops nothing.
 * The names are checked again here against the protocol's patterns before they go into an argv,
 * whatever the message said. A unit systemd does not know (LoadState `not-found`) is unknown,
 * never inactive: it never was there to stop.
 */

export type DienstMeldung = NonNullable<
  Extract<NachrichtVomAgenten, { typ: "zustand" }>["dienste"]
>[number];

export type BeobachtetDeps = PruefDeps & { nutzer: NutzerLesen };

const PROPERTIES = "Id,ActiveState,LoadState";

const unbekannt = (units: readonly string[]): Unit[] =>
  units.map((name) => ({ name, aktiv: "unknown" }));

/** The argv for `systemctl show`, or undefined for a name the pattern refuses or a missing user */
const showArgv = async (
  deps: BeobachtetDeps,
  units: readonly string[],
  nutzer: string | null,
): Promise<string[] | undefined> => {
  if (units.length === 0 || !units.every(unitGueltig)) return undefined;
  const show = ["show", "-p", PROPERTIES, "--", ...units];
  if (nutzer === null) return ["systemctl", ...show];
  if (!linuxNutzerGueltig(nutzer)) return undefined;
  const n = await deps.nutzer(nutzer);
  return n && alsNutzer(n, ["systemctl", "--user", ...show]);
};

/** The ActiveState of each unit, as the user `nutzer` or of the system (null) */
export const fremdeUnitsLesen = async (
  deps: BeobachtetDeps,
  units: readonly string[],
  nutzer: string | null,
): Promise<Unit[]> => {
  const argv = await showArgv(deps, units, nutzer);
  if (!argv) return unbekannt(units);
  const r = await mitFrist(deps.planen, UNITS_MS, (signal) => deps.lesen(argv, signal));
  if (!r.ok || r.wert.code !== 0) return unbekannt(units);
  const bloecke = bloeckeLesen(r.wert.aus);
  return units.map((name): Unit => {
    const werte = bloecke.get(name);
    if (werte?.get("LoadState") === "not-found") return { name, aktiv: "unknown" };
    return { name, aktiv: aktivVon(werte?.get("ActiveState")) };
  });
};

/** The check as an installation's target; no command, ever */
const zielVon = (h: BeobachteterDienst["health"]): PruefZiel => h;

const dienstLesen = async (deps: BeobachtetDeps, d: BeobachteterDienst): Promise<DienstMeldung> => {
  const [units, health]: [Unit[], Health] = await Promise.all([
    fremdeUnitsLesen(deps, d.units, d.nutzer),
    // no user: `befehl` is not a target of an observed service
    healthPruefen(deps, zielVon(d.health), d.dienstId, undefined),
  ]);
  return { dienstId: d.dienstId, units, health };
};

/** Every observed service, side by side */
export const beobachteteLesen = (
  deps: BeobachtetDeps,
  dienste: readonly BeobachteterDienst[],
): Promise<DienstMeldung[]> => Promise.all(dienste.map((d) => dienstLesen(deps, d)));

export type BeobachtetHalter = {
  /** Takes the newest list; false, and nothing kept, on a server that is managed */
  setzen: (dienste: readonly BeobachteterDienst[]) => boolean;
  lesen: () => readonly BeobachteterDienst[];
};

/**
 * The list of the newest `beobachten`, in memory: the Zentrale sends it again after every
 * `willkommen`. Only a server that is only observed keeps one (Z-1102): on a managed server
 * the agent reads only what a manifest describes
 */
export const beobachtetHalter = (nurBeobachten: boolean): BeobachtetHalter => {
  let liste: readonly BeobachteterDienst[] = [];
  return {
    setzen: (dienste) => {
      if (!nurBeobachten) return false;
      liste = [...dienste];
      return true;
    },
    lesen: () => liste,
  };
};

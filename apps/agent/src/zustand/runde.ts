import { type NachrichtVomAgenten, PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import type { Gedaechtnis, InstallationsEintrag } from "../einrichtung/gedaechtnis.ts";
import { type NutzerLesen, nutzerName } from "../einrichtung/nutzer.ts";
import { type Health, healthPruefen, type PruefDeps, type Unit, unitsLesen } from "./pruefen.ts";

/*
 * One round of checks (BAULISTE.md Z-403; docs/plan.md, "Health auf dem Server"): every
 * installation the agent's record names as `fertig`, its units and its health checked side by side
 * as its own user, all of them in one `zustand` message. An installation still `angelegt` is not
 * reported: it is being set up or torn down, and the job says how that went. The Zentrale judges
 * what the message says (packages/planung, installationBewerten).
 */

export type ZustandNachricht = Extract<NachrichtVomAgenten, { typ: "zustand" }>;

export type ZustandDeps = PruefDeps & {
  gedaechtnis: Pick<Gedaechtnis, "lesen">;
  nutzer: NutzerLesen;
  jetzt: () => number;
};

export type ZustandGelesen =
  | { ok: true; nachricht: ZustandNachricht }
  | { ok: false; grund: string };

const OHNE_ZIEL: Health = {
  zustand: "unbekannt",
  grund: "Ziel der Prüfung unbekannt (vor Z-403 eingerichtet)",
};

const installationPruefen = async (
  deps: ZustandDeps,
  name: string,
  eintrag: InstallationsEintrag,
): Promise<ZustandNachricht["installationen"][number]> => {
  // set up before the record kept the target: nothing to check against, and never green
  if (!eintrag.pruefung) return { installationId: name, units: [], health: OHNE_ZIEL };
  const { units, ziel } = eintrag.pruefung;
  const n = await deps.nutzer(nutzerName(name));
  const [gelesen, health]: [Unit[], Health] = await Promise.all([
    unitsLesen(deps, units, n),
    healthPruefen(deps, ziel, name, n),
  ]);
  return { installationId: name, units: gelesen, health };
};

export const zustandLesen = async (deps: ZustandDeps): Promise<ZustandGelesen> => {
  const g = await deps.gedaechtnis.lesen();
  // an empty list would tell the Zentrale there are no installations
  if (!g.ok) return g;
  const fertig = [...g.stand]
    .filter(([, e]) => e.zustand === "fertig")
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const installationen = await Promise.all(
    fertig.map(([name, e]) => installationPruefen(deps, name, e)),
  );
  return {
    ok: true,
    nachricht: { typ: "zustand", protokoll: PROTOKOLL_VERSION, zeit: deps.jetzt(), installationen },
  };
};

/**
 * The reader of meldungen.ts: a round, or undefined while the last one still runs or when the
 * record cannot be read (logged; the Zentrale then sees no report and takes the installations as
 * unknown after 90 s)
 */
export const zustandMelder = (
  deps: ZustandDeps,
  log: (msg: string, mehr?: Record<string, unknown>) => void,
): (() => Promise<ZustandNachricht | undefined>) =>
  einzeln(async () => {
    const r = await zustandLesen(deps);
    if (r.ok) return r.nachricht;
    log("state not read", { grund: r.grund });
    return undefined;
  });

/**
 * f, but never twice at once: a call while the last one still runs returns undefined at once
 * instead of starting another, so a slow round never piles checks up
 */
export const einzeln = <T>(f: () => Promise<T>): (() => Promise<T | undefined>) => {
  let laeuft = false;
  return async () => {
    if (laeuft) return undefined;
    laeuft = true;
    try {
      return await f();
    } finally {
      laeuft = false;
    }
  };
};

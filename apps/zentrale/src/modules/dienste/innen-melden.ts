import { bewertungFortschreiben, installationBewerten, nachFrist } from "@steuerzentrale/planung";
import type { NachrichtVomAgenten } from "@steuerzentrale/protokoll";
import { dienstInnenSetzen } from "../audit/index.ts";
import type { DienstDeps } from "./ereignis.ts";
import { type DienstZeile, diensteAufServer, dienstInnenLesen } from "./lesen.ts";
import { dienstStoerungFortschreiben } from "./stoerung.ts";

/*
 * What the agent reports about the observed services on its server (BAULISTE.md Z-1103): each is
 * rated by the same rules as an installation (packages/planung, installationBewerten; without a
 * check the units alone decide), the rating kept as a measurement (dienst_innen), and a fault
 * checked with the side outside. Only services of this server and its operator, not removed, are
 * reached; a report of any other is dropped and logged.
 */

type Eintrag = NonNullable<Extract<NachrichtVomAgenten, { typ: "zustand" }>["dienste"]>[number];

export type InnenMeldenDeps = DienstDeps & { log: (zeile: string) => void };

const annehmen = (deps: InnenMeldenDeps, d: DienstZeile, e: Eintrag, jetzt: number) => {
  const gespeichert = dienstInnenLesen(deps.db, d.betreiberId, d.dienstId);
  // an overdue report ends the old rating first, as for an installation
  const alt = gespeichert && nachFrist(gespeichert, jetzt);
  const { stand } = bewertungFortschreiben(
    alt,
    installationBewerten(e, d.healthPort !== null),
    jetzt,
  );
  dienstInnenSetzen(deps.schreibDb, {
    betreiberId: d.betreiberId,
    dienstId: d.dienstId,
    bewertung: stand.bewertung,
    grund: JSON.stringify(stand.grund),
    seit: stand.seit,
    gemeldetAm: stand.gemeldetAm,
    meldung: JSON.stringify({ units: e.units, health: e.health }),
  });
  dienstStoerungFortschreiben(deps, d, jetzt);
};

/** Takes the observed services of one `zustand` message, at the Zentrale's time */
export const dienstZustandAnnehmen = (
  deps: InnenMeldenDeps,
  server: { betreiberId: string; serverId: string },
  eintraege: readonly Eintrag[],
  jetzt: number,
): void => {
  const auf = new Map(
    diensteAufServer(deps.db, server.betreiberId, server.serverId).map((d) => [d.dienstId, d]),
  );
  // the last entry of a service counts, should the agent name one twice
  for (const [dienstId, e] of new Map(eintraege.map((e) => [e.dienstId, e]))) {
    const d = auf.get(dienstId);
    if (d) annehmen(deps, d, e, jetzt);
    else
      deps.log(
        JSON.stringify({
          msg: "state of an unknown service dropped",
          serverId: server.serverId,
          dienstId,
        }),
      );
  }
};

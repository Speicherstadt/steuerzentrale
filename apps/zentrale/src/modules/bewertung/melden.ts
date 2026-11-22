import { manifestPruefen } from "@steuerzentrale/manifest";
import { bewertungFortschreiben, installationBewerten } from "@steuerzentrale/planung";
import type { NachrichtVomAgenten } from "@steuerzentrale/protokoll";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { bewertungSetzen } from "../audit/index.ts";
import { type Installation, installationenAufServer } from "../installationen/index.ts";
import { standVon } from "./lesen.ts";
import { fristAnwenden } from "./pruefung.ts";
import { stoerungFortschreiben } from "./stoerung.ts";

/*
 * What the agent reports about the installations on its server every 30 seconds (BAULISTE.md
 * Z-403): each is rated (packages/planung), the rating kept as a measurement at the installation,
 * a change also in the history, and a fault checked. Only installations of this server and its
 * operator, not removed, are reached; a report of any other is dropped and logged.
 */

type Zustand = Extract<NachrichtVomAgenten, { typ: "zustand" }>;
type Eintrag = Zustand["installationen"][number];

export type MeldenDeps = { db: Db; schreibDb: SchreibDb; log: (zeile: string) => void };

/**
 * Whether the installation's manifest has a health check: for `keine` the agent reports health
 * unknown and the units alone decide. A stored manifest that no longer reads counts as with one,
 * so it is never green by default.
 */
const mitHealth = (i: Installation): boolean => {
  const geprueft = manifestPruefen(i.manifest);
  return !geprueft.ok || geprueft.manifest.health.art !== "keine";
};

const eintragAnnehmen = (deps: MeldenDeps, i: Installation, e: Eintrag, jetzt: number) => {
  const wer = { betreiberId: i.betreiberId, installationId: i.installationId };
  const gespeichert = standVon(i);
  // an overdue report first ends the old rating, so the history never jumps over the silence
  const alt = gespeichert && fristAnwenden(deps.schreibDb, wer, gespeichert, i.meldung, jetzt);
  const { stand, wechsel } = bewertungFortschreiben(
    alt,
    installationBewerten(e, mitHealth(i)),
    jetzt,
  );
  bewertungSetzen(deps.schreibDb, {
    ...wer,
    bewertung: stand.bewertung,
    grund: JSON.stringify(stand.grund),
    seit: stand.seit,
    gemeldetAm: stand.gemeldetAm,
    meldung: JSON.stringify({ units: e.units, health: e.health }),
    wechsel,
  });
  stoerungFortschreiben(deps.db, deps.schreibDb, wer, stand, jetzt);
};

/** Takes one `zustand` message of a server's agent, at the Zentrale's time */
export const zustandAnnehmen = (
  deps: MeldenDeps,
  server: { betreiberId: string; serverId: string },
  n: Zustand,
  jetzt: number,
): void => {
  const auf = new Map(
    installationenAufServer(deps.db, server.betreiberId, server.serverId).map((i) => [
      i.installationId,
      i,
    ]),
  );
  // the last entry of an installation counts, should the agent name one twice
  const eintraege = new Map(n.installationen.map((e) => [e.installationId, e]));
  for (const [installationId, e] of eintraege) {
    const i = auf.get(installationId);
    if (!i) {
      deps.log(
        JSON.stringify({
          msg: "state of an unknown installation dropped",
          serverId: server.serverId,
          installationId,
        }),
      );
      continue;
    }
    eintragAnnehmen(deps, i, e, jetzt);
  }
};

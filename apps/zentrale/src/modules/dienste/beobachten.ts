import { Beobachten, PROTOKOLL_VERSION, schreiben } from "@steuerzentrale/protokoll";
import type { Db } from "../../db/oeffnen.ts";
import type { Verbindungen } from "../verbindung/verbindungen.ts";
import { beobachtetAuf } from "./innen.ts";
import { diensteAufServer } from "./lesen.ts";

/*
 * The list of observed units for one server's agent (BAULISTE.md Z-1103): every service not removed
 * whose units it reads, as the message `beobachten`. Sent after `willkommen` and after every change
 * of a service on the server; the newest list replaces the one before, an empty one ends the
 * reading. Not sent while the server is not connected: the next `willkommen` brings it.
 */

export const beobachtenNachricht = (db: Db, betreiberId: string, serverId: string): string =>
  schreiben(Beobachten, {
    typ: "beobachten",
    protokoll: PROTOKOLL_VERSION,
    dienste: beobachtetAuf(diensteAufServer(db, betreiberId, serverId)),
  });

/** Sends the list to each named server that is connected; null and repeats are skipped */
export const beobachtenSenden = (
  deps: { db: Db; verbindungen: Pick<Verbindungen, "senden"> },
  betreiberId: string,
  serverIds: readonly (string | null | undefined)[],
): void => {
  for (const serverId of new Set(serverIds))
    if (serverId)
      deps.verbindungen.senden(
        betreiberId,
        serverId,
        beobachtenNachricht(deps.db, betreiberId, serverId),
      );
};

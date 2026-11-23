import { fuerVersion, PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";

/*
 * The open agent connections of this Zentrale, in memory (BAULISTE.md Z-303): at most one per
 * server; a newer one replaces the older. A restart forgets them, and the agents connect again
 * within seconds (their backoff). Whether a connection is open is a fact of this process, not of the
 * database, so it is not written anywhere. A greeted connection keeps the agent's protocol version:
 * what goes to it is stamped with that version (packages/protokoll, `fuerVersion`; Z-504).
 */

/** What the Zentrale needs of one open connection */
export type Sockel = {
  senden: (text: string) => void;
  schliessen: (code: number, grund: string) => void;
};

export type Verbindungen = {
  /** Registers the connection; an older one of the same server is closed with `ersetztCode` */
  anmelden: (betreiberId: string, serverId: string, sockel: Sockel, jetzt: number) => void;
  /** Forgets the connection, if it is still the server's one */
  abmelden: (betreiberId: string, serverId: string, sockel: Sockel) => void;
  /**
   * Marks the connection as greeted (`willkommen` sent): from now on it takes jobs, in the agent's
   * protocol version (its `hallo`)
   */
  gruessen: (betreiberId: string, serverId: string, sockel: Sockel, protokoll?: number) => void;
  /** Sends to the server's greeted connection; false when there is none */
  senden: (betreiberId: string, serverId: string, text: string) => boolean;
  /** Whether the connection is still the server's one: a replaced or closed one has no say */
  aktuell: (betreiberId: string, serverId: string, sockel: Sockel) => boolean;
  /** Since when the server's connection is open, or undefined */
  verbundenSeit: (betreiberId: string, serverId: string) => number | undefined;
  /** Closes the server's connection (a revoked certificate); true if one was open */
  trennen: (betreiberId: string, serverId: string, code: number, grund: string) => boolean;
};

const schluessel = (betreiberId: string, serverId: string) => `${betreiberId}\u0000${serverId}`;

export const verbindungen = (ersetztCode: number): Verbindungen => {
  const offen = new Map<
    string,
    { sockel: Sockel; seit: number; gegruesst: boolean; protokoll: number }
  >();
  const trennen: Verbindungen["trennen"] = (betreiberId, serverId, code, grund) => {
    const k = schluessel(betreiberId, serverId);
    const eintrag = offen.get(k);
    if (!eintrag) return false;
    offen.delete(k);
    eintrag.sockel.schliessen(code, grund);
    return true;
  };
  return {
    anmelden: (betreiberId, serverId, sockel, jetzt) => {
      trennen(betreiberId, serverId, ersetztCode, "replaced by a newer connection");
      offen.set(schluessel(betreiberId, serverId), {
        sockel,
        seit: jetzt,
        gegruesst: false,
        protokoll: PROTOKOLL_VERSION,
      });
    },
    gruessen: (betreiberId, serverId, sockel, protokoll = PROTOKOLL_VERSION) => {
      const eintrag = offen.get(schluessel(betreiberId, serverId));
      if (eintrag?.sockel !== sockel) return;
      eintrag.gegruesst = true;
      eintrag.protokoll = protokoll;
    },
    senden: (betreiberId, serverId, text) => {
      const eintrag = offen.get(schluessel(betreiberId, serverId));
      if (!eintrag?.gegruesst) return false;
      eintrag.sockel.senden(fuerVersion(text, eintrag.protokoll));
      return true;
    },
    abmelden: (betreiberId, serverId, sockel) => {
      const k = schluessel(betreiberId, serverId);
      if (offen.get(k)?.sockel === sockel) offen.delete(k);
    },
    aktuell: (betreiberId, serverId, sockel) =>
      offen.get(schluessel(betreiberId, serverId))?.sockel === sockel,
    verbundenSeit: (betreiberId, serverId) => offen.get(schluessel(betreiberId, serverId))?.seit,
    trennen,
  };
};
